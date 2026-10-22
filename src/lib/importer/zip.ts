/**
 * importFromZip — Claude Design "Project archive" (artifact.html |
 * index.html + manifest.json + assets/) or a Motion Studio export → Project
 * (CONTRACTS §7). Every image / font / media file becomes a data-URL asset,
 * source files stay text, the entry page goes through importFromHtml with
 * those files merged in. A scene .jsx that renders <Stage> wins over a page
 * that only bootstraps it.
 */
import JSZip from "jszip";
import type { Project, ProjectFile, StageMeta } from "@/lib/types";
import { MANIFEST_GENERATOR } from "./exportZip";
import { assetFile, fileKindFor, isSourceKind, isUnsafePath, normaliseProjectPath, textFile } from "./files";
import { importFromHtmlDetailed } from "./html";
import { importFromJsxDetailed } from "./jsx";
import { resolveMeta, type MetaHints } from "./meta";
import { buildProject, errorMessage, type ImportResult } from "./project";

export type ZipInput = ArrayBuffer | Blob | Uint8Array;

export interface ZipImportOptions {
  name?: string;
}

const ORIGIN = "claude-design-zip";
const JUNK_ENTRY = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|\._[^/]*$)/;
const DOC_FILE = /^(readme|license|changelog)(\.|$)/i;
const RUNTIME_FILE = /(^|\/)animations\.(jsx|js|tsx|ts)$/;
const STAGE_TAG = /<Stage\b/;

interface Manifest {
  name?: string;
  createdAt?: string;
  entry?: string;
  generator?: string;
  meta: MetaHints;
}

async function toArrayBuffer(input: ZipInput): Promise<ArrayBuffer> {
  if (input instanceof ArrayBuffer) return input;
  if (input instanceof Uint8Array) {
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
  }
  return input.arrayBuffer();
}

function readManifest(text: string, warnings: string[]): Manifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    warnings.push(`manifest.json could not be parsed (${errorMessage(error)})`);
    return { meta: {} };
  }
  if (typeof raw !== "object" || raw === null) return { meta: {} };
  const record = raw as Record<string, unknown>;
  const str = (key: string): string | undefined => (typeof record[key] === "string" ? (record[key] as string) : undefined);
  const metaSource = typeof record.meta === "object" && record.meta !== null ? (record.meta as Record<string, unknown>) : record;
  const meta: MetaHints = {};
  for (const key of ["width", "height", "duration", "fps"] as const) {
    if (typeof metaSource[key] === "number") meta[key] = metaSource[key] as number;
  }
  if (typeof metaSource.background === "string") meta.background = metaSource.background as string;
  return { name: str("name"), createdAt: str("createdAt"), entry: str("entry"), generator: str("generator"), meta };
}

/** Drop a single wrapping folder ("my-project/artifact.html" → "artifact.html"). */
function stripCommonRoot(paths: readonly string[]): (path: string) => string {
  const roots = new Set(paths.map((p) => p.split("/")[0]));
  const nested = paths.every((p) => p.includes("/"));
  if (roots.size !== 1 || !nested) return (path) => path;
  const prefix = `${[...roots][0]}/`;
  return (path) => path.slice(prefix.length);
}

interface ZipContents {
  files: Record<string, ProjectFile>;
  skipped: string[];
}

async function readEntries(zip: JSZip, warnings: string[]): Promise<ZipContents> {
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && !JUNK_ENTRY.test(entry.name));
  const unsafe = entries.filter((entry) => isUnsafePath(entry.name));
  if (unsafe.length) warnings.push(`Skipped ${unsafe.length} entr${unsafe.length === 1 ? "y" : "ies"} with unsafe paths`);
  const safe = entries.filter((entry) => !isUnsafePath(entry.name));
  const rebase = stripCommonRoot(safe.map((entry) => normaliseProjectPath(entry.name)));

  const files: Record<string, ProjectFile> = {};
  const skipped: string[] = [];
  for (const entry of safe) {
    const path = rebase(normaliseProjectPath(entry.name));
    if (!path) continue;
    const kind = fileKindFor(path);
    if (kind === "asset" || (kind === undefined && path.startsWith("assets/"))) {
      files[path] = assetFile(path, await entry.async("uint8array"));
    } else if (kind !== undefined) {
      files[path] = textFile(path, kind, await entry.async("string"));
    } else if (!DOC_FILE.test(path.slice(path.lastIndexOf("/") + 1))) {
      skipped.push(path);
    }
  }
  return { files, skipped };
}

/** artifact.html > index.html > the page that looks most like a Motion scene. */
function pickEntryHtml(pages: readonly ProjectFile[]): ProjectFile | undefined {
  const score = (file: ProjectFile): number => {
    const name = file.path.slice(file.path.lastIndexOf("/") + 1).toLowerCase();
    const text = file.content;
    let s = 0;
    if (name === "artifact.html") s += 100;
    else if (name === "index.html") s += 50;
    if (STAGE_TAG.test(text)) s += 5;
    if (text.includes("animations.jsx")) s += 3;
    if (/__render|__seek/.test(text)) s += 1;
    if (name.includes("standalone")) s -= 4;
    if (file.path.includes("/")) s -= 1;
    return s;
  };
  return [...pages].sort((a, b) => score(b) - score(a))[0];
}

/** A source file (other than the runtime) that renders a <Stage>. */
function findStageScene(files: Record<string, ProjectFile>): ProjectFile | undefined {
  const candidates = Object.values(files).filter(
    (f) => isSourceKind(f.kind) && !RUNTIME_FILE.test(f.path) && STAGE_TAG.test(f.content),
  );
  return candidates.sort((a, b) => a.path.split("/").length - b.path.split("/").length)[0];
}

function nameFromPath(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  return base.replace(/[-_]+/g, " ").trim() || "Imported scene";
}

export async function importFromZipDetailed(input: ZipInput, opts: ZipImportOptions = {}): Promise<ImportResult> {
  const warnings: string[] = [];
  const zip = await JSZip.loadAsync(await toArrayBuffer(input));
  const { files, skipped } = await readEntries(zip, warnings);
  if (skipped.length) {
    const shown = skipped.slice(0, 6).join(", ");
    warnings.push(`Ignored ${skipped.length} file(s) of unsupported types: ${shown}${skipped.length > 6 ? ", …" : ""}`);
  }

  const manifest = files["manifest.json"] ? readManifest(files["manifest.json"].content, warnings) : { meta: {} };
  delete files["manifest.json"];
  const name = opts.name ?? manifest.name;
  const pages = Object.values(files).filter((f) => f.kind === "html");
  for (const page of pages) delete files[page.path];

  const finish = (result: ImportResult): ImportResult => ({
    project: result.project,
    warnings: [...warnings, ...result.warnings],
  });

  // Motion Studio's own export: the entry is already a scene file, nothing to convert.
  const ownEntry =
    manifest.generator === MANIFEST_GENERATOR && manifest.entry ? files[normaliseProjectPath(manifest.entry)] : undefined;
  if (ownEntry) {
    delete files[ownEntry.path];
    const fallbackMeta: StageMeta = resolveMeta(manifest.meta);
    const project = buildProject(
      { name: name ?? "Motion Studio project", entrySource: ownEntry.content, entry: ownEntry.path, files, fallbackMeta, origin: ORIGIN, createdAt: manifest.createdAt },
      warnings,
    );
    return { project, warnings };
  }

  const entryPage = pickEntryHtml(pages);
  const ignoredPages = pages.filter((p) => p !== entryPage).map((p) => p.path);
  if (ignoredPages.length) warnings.push(`Other HTML files in the archive were ignored: ${ignoredPages.join(", ")}`);
  const stageScene = findStageScene(files);
  const common = { files, createdAt: manifest.createdAt, origin: ORIGIN } as const;

  if (entryPage) {
    const scene = !STAGE_TAG.test(entryPage.content) && stageScene ? { source: stageScene.content, path: stageScene.path } : undefined;
    return finish(importFromHtmlDetailed(entryPage.content, { ...common, name, scene }));
  }
  if (stageScene) {
    delete files[stageScene.path];
    return finish(importFromJsxDetailed(stageScene.content, { ...common, name: name ?? nameFromPath(stageScene.path) }));
  }
  throw new Error("The archive has no scene: expected artifact.html, index.html or a .jsx file that renders <Stage>");
}

export async function importFromZip(input: ZipInput, opts?: ZipImportOptions): Promise<Project> {
  return (await importFromZipDetailed(input, opts)).project;
}

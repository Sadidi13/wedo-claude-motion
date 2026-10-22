/**
 * importFromHtml — standalone HTML export / pasted HTML → Project
 * (CONTRACTS §7). DOM-free so it runs in node tests and on the server.
 *
 * Scripts become `scene.jsx` (see scripts.ts), inline <style> blocks become
 * `styles.css`, Google Fonts <link>s become `fonts.css` (both imported by
 * the scene), meta is detected from the Stage / `window.__videoMeta` /
 * `hz:canvas-*` hints, and a page without a <Stage> is wrapped in one.
 */
import type { Project, ProjectFile } from "@/lib/types";
import { assembleScene } from "./assemble";
import { normaliseFileTable, normaliseProjectPath, textFile } from "./files";
import { extractHtml, hasStaticMarkup, type HtmlExtraction } from "./htmlExtract";
import { readHtmlMetaHints, readStageTagMeta, readVideoMeta, resolveMeta, type MetaHints } from "./meta";
import { buildProject, type ImportResult } from "./project";
import { collectSceneScripts } from "./scripts";

export interface HtmlImportOptions {
  name?: string;
  /** other files from the archive (assets, css, helper components) keyed by path */
  files?: Record<string, ProjectFile>;
  createdAt?: string;
  origin?: NonNullable<Project["origin"]>;
  /** use this file as the scene instead of the page's own scripts (the page only bootstraps it) */
  scene?: { source: string; path: string };
}

const STYLES_FILE = "styles.css";
const FONTS_FILE = "fonts.css";

function absoluteUrl(href: string): string {
  return href.startsWith("//") ? `https:${href}` : href;
}

/** Inline styles → styles.css, Google Fonts → fonts.css, local stylesheet links → imports. Returns the import specifiers. */
function harvestStyles(page: HtmlExtraction, files: Record<string, ProjectFile>, warnings: string[]): string[] {
  const cssImports: string[] = [];
  const blocks = page.styles.map((css) => css.trim()).filter(Boolean);
  if (blocks.length) {
    const existing = files[STYLES_FILE]?.kind === "css" ? `${files[STYLES_FILE].content.trim()}\n\n` : "";
    files[STYLES_FILE] = textFile(STYLES_FILE, "css", `${existing}${blocks.join("\n\n")}\n`);
    cssImports.push(`./${STYLES_FILE}`);
  }

  const fonts: string[] = [];
  for (const link of page.links) {
    const href = link.href?.trim();
    if (!href) continue;
    const rel = (link.rel ?? "").toLowerCase();
    if (/fonts\.googleapis\.com/i.test(href)) {
      if (rel.includes("stylesheet") || /\/css/.test(href)) fonts.push(absoluteUrl(href));
      continue;
    }
    if (!rel.includes("stylesheet")) continue;
    if (/^(https?:)?\/\//i.test(href)) {
      warnings.push(`External stylesheet "${href}" was not imported`);
      continue;
    }
    const path = normaliseProjectPath(href.split(/[?#]/)[0]);
    if (files[path]?.kind === "css") cssImports.push(`./${path}`);
    else warnings.push(`Stylesheet "${href}" referenced by the page was not found in the archive`);
  }
  if (fonts.length) {
    files[FONTS_FILE] = textFile(FONTS_FILE, "css", fonts.map((url) => `@import url("${url}");`).join("\n") + "\n");
    cssImports.push(`./${FONTS_FILE}`);
  }
  return cssImports;
}

function firstVideoMeta(page: HtmlExtraction): MetaHints {
  return page.scripts.map((s) => readVideoMeta(s.body)).find((hints) => Object.keys(hints).length) ?? {};
}

export function importFromHtmlDetailed(html: string, opts: HtmlImportOptions = {}): ImportResult {
  const warnings: string[] = [];
  const files = normaliseFileTable(opts.files);
  const page = extractHtml(html);

  let code: string;
  let videoMeta: MetaHints;
  if (opts.scene) {
    code = opts.scene.source;
    videoMeta = firstVideoMeta(page);
    delete files[normaliseProjectPath(opts.scene.path)];
  } else {
    ({ code, videoMeta } = collectSceneScripts(page.scripts, files, warnings));
  }

  const cssImports = harvestStyles(page, files, warnings);
  const fallbackMeta = resolveMeta(readStageTagMeta(code), videoMeta, readHtmlMetaHints(page.metas, page.canvas));
  const staticHtml = hasStaticMarkup(page.body) ? page.body : undefined;

  const assembled = assembleScene({ code, cssImports, fallbackMeta, staticHtml });
  warnings.push(...assembled.warnings);
  if (staticHtml && !assembled.staticHtmlUsed) {
    warnings.push("Static markup in <body> was ignored because the page renders with React");
  }

  const project = buildProject(
    {
      name: opts.name ?? page.title ?? "Imported HTML",
      entrySource: assembled.source,
      files,
      fallbackMeta,
      origin: opts.origin ?? "html",
      createdAt: opts.createdAt,
    },
    warnings,
  );
  return { project, warnings };
}

export function importFromHtml(html: string, opts?: { name?: string }): Project {
  return importFromHtmlDetailed(html, opts).project;
}

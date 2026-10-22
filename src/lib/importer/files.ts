/**
 * Project-file helpers for the importer: posix path normalisation, mapping a
 * file extension to a ProjectFileKind and small ProjectFile constructors.
 * Pure, no node built-ins (runs in the browser and in vitest).
 */
import type { ProjectFile, ProjectFileKind } from "@/lib/types";
import { bytesToDataUrl, extensionOf, isAssetPath, mimeTypeFor } from "./dataUrl";

const KIND_BY_EXTENSION: Record<string, ProjectFileKind> = {
  jsx: "jsx",
  js: "js",
  mjs: "js",
  cjs: "js",
  tsx: "tsx",
  ts: "ts",
  mts: "ts",
  css: "css",
  html: "html",
  htm: "html",
  json: "json",
};

/** "./a//b\\c.jsx" → "a/b/c.jsx"; ".." segments are resolved, a leading "/" is dropped. */
export function normaliseProjectPath(path: string): string {
  const out: string[] = [];
  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join("/");
}

/** True when the zip entry would escape the project root ("../x", "/etc/x", "C:\\x"). */
export function isUnsafePath(path: string): boolean {
  const normalised = path.replace(/\\/g, "/");
  return normalised.startsWith("/") || /^[a-zA-Z]:/.test(normalised) || normalised.split("/").includes("..");
}

/** ProjectFileKind for a path; `undefined` for extensions the project model does not know. */
export function fileKindFor(path: string): ProjectFileKind | undefined {
  if (isAssetPath(path)) return "asset";
  return KIND_BY_EXTENSION[extensionOf(path)];
}

export function isSourceKind(kind: ProjectFileKind | undefined): boolean {
  return kind === "jsx" || kind === "js" || kind === "tsx" || kind === "ts";
}

export function textFile(path: string, kind: Exclude<ProjectFileKind, "asset">, content: string): ProjectFile {
  return { path: normaliseProjectPath(path), kind, content };
}

export function assetFile(path: string, bytes: Uint8Array): ProjectFile {
  const normalised = normaliseProjectPath(path);
  return { path: normalised, kind: "asset", content: bytesToDataUrl(bytes, mimeTypeFor(normalised)) };
}

/** Re-key a file table by normalised path (tolerates "./scene.jsx" style keys from callers). */
export function normaliseFileTable(files: Record<string, ProjectFile> | undefined): Record<string, ProjectFile> {
  const table: Record<string, ProjectFile> = {};
  for (const file of Object.values(files ?? {})) {
    const path = normaliseProjectPath(file.path);
    table[path] = file.path === path ? file : { ...file, path };
  }
  return table;
}

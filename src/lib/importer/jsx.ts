/**
 * importFromJsx — a raw Stage-based scene file → Project (CONTRACTS §7).
 * A well-formed Claude Motion scene is kept byte-for-byte (plus layer ids);
 * a file without `export default` gets one for its Scene / App / … component,
 * and a file without a <Stage> is wrapped in one with a warning.
 */
import type { Project, ProjectFile } from "@/lib/types";
import { assembleScene } from "./assemble";
import { normaliseFileTable } from "./files";
import { readStageTagMeta, readVideoMeta, resolveMeta } from "./meta";
import { buildProject, type ImportResult } from "./project";

export interface JsxImportOptions {
  name?: string;
  /** other project files (assets, css, helper components) keyed by path */
  files?: Record<string, ProjectFile>;
  createdAt?: string;
  origin?: NonNullable<Project["origin"]>;
}

export function importFromJsxDetailed(source: string, opts: JsxImportOptions = {}): ImportResult {
  const warnings: string[] = [];
  const fallbackMeta = resolveMeta(readStageTagMeta(source), readVideoMeta(source));
  const assembled = assembleScene({ code: source, cssImports: [], fallbackMeta });
  warnings.push(...assembled.warnings);
  const project = buildProject(
    {
      name: opts.name ?? "Imported scene",
      entrySource: assembled.source,
      files: normaliseFileTable(opts.files),
      fallbackMeta,
      origin: opts.origin ?? "jsx",
      createdAt: opts.createdAt,
    },
    warnings,
  );
  return { project, warnings };
}

export function importFromJsx(source: string, opts?: { name?: string }): Project {
  return importFromJsxDetailed(source, opts).project;
}

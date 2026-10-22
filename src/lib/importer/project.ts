/**
 * Final step of every import: run `ensureLayerIds` on the entry, read the
 * meta with `parseScene` (falling back to the detected meta + a warning when
 * the entry does not parse yet) and build the Project record.
 */
import { nanoid } from "nanoid";
import { ensureLayerIds, parseScene } from "@/lib/parser";
import type { Project, ProjectFile, StageMeta } from "@/lib/types";
import { fileKindFor, isSourceKind, normaliseFileTable, normaliseProjectPath, textFile } from "./files";
import { describeMeta } from "./meta";

export interface BuildProjectInput {
  name: string;
  entrySource: string;
  /** path of the entry file (default "scene.jsx") */
  entry?: string;
  /** other project files (css, helper components, assets); the entry is added / replaced */
  files?: Record<string, ProjectFile>;
  /** meta used when the entry cannot be parsed */
  fallbackMeta: StageMeta;
  origin: NonNullable<Project["origin"]>;
  id?: string;
  createdAt?: string;
}

/** Message of any thrown value, for warnings. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildProject(input: BuildProjectInput, warnings: string[]): Project {
  const entry = normaliseProjectPath(input.entry ?? "scene.jsx") || "scene.jsx";
  let source = input.entrySource;
  let meta = input.fallbackMeta;
  try {
    source = ensureLayerIds(source).source;
    meta = parseScene(source).meta;
  } catch (error) {
    warnings.push(
      `"${entry}" could not be parsed as a Stage scene (${errorMessage(error)}); using ${describeMeta(meta)} until it is fixed`,
    );
  }

  const files = normaliseFileTable(input.files);
  const kind = fileKindFor(entry);
  files[entry] = textFile(entry, isSourceKind(kind) && kind !== undefined && kind !== "asset" ? kind : "jsx", source);

  const now = new Date().toISOString();
  return {
    id: input.id ?? nanoid(12),
    name: input.name,
    entry,
    files,
    meta,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    origin: input.origin,
  };
}

/** Result of the `…Detailed` import variants: the project plus non-fatal notices for the UI. */
export interface ImportResult {
  project: Project;
  warnings: string[];
}

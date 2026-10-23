/**
 * Import-specifier resolution for the mini module system (CONTRACTS.md §3):
 *
 *   react                                   -> builtin "react"      (the page's React)
 *   react-dom, react-dom/client             -> builtin "react-dom"  (capture shim)
 *   lucide-react                            -> builtin "lucide-react"
 *   three                                   -> builtin "three"      (the pinned three.js build)
 *   @motion/runtime, motion-runtime,
 *   ./animations(.jsx|.js|.tsx|.ts)         -> builtin "runtime"    (src/runtime: motion + Three3D)
 *   ./relative/path                         -> a project file (extension + index probing)
 *   data:…                                  -> the data URL itself (asset imports after rewriting)
 *   anything else                           -> LoadError
 *
 * Pure: takes the normalised file table and returns a Resolution; no DOM.
 */

import type { ProjectFile } from "@/lib/types";
import { LoadError } from "./errors";
import { candidatePaths, isRelativeSpecifier, normalisePath, resolveRelative } from "./paths";

export type BuiltinName = "react" | "react-dom" | "lucide-react" | "three" | "runtime";

export type Resolution =
  | { kind: "builtin"; name: BuiltinName }
  | { kind: "file"; path: string; file: ProjectFile }
  | { kind: "data"; url: string };

const BARE_BUILTINS: Record<string, BuiltinName> = {
  react: "react",
  "react-dom": "react-dom",
  "react-dom/client": "react-dom",
  "lucide-react": "lucide-react",
  three: "three",
  "@motion/runtime": "runtime",
  "motion-runtime": "runtime",
};

const RUNTIME_ALIAS_FILE = /^animations(\.(jsx|js|tsx|ts))?$/;

/** Project files keyed by normalised path (tolerates "./scene.jsx" style keys). */
export function buildFileTable(files: Record<string, ProjectFile>): Record<string, ProjectFile> {
  const table: Record<string, ProjectFile> = {};
  for (const file of Object.values(files)) table[normalisePath(file.path)] = file;
  return table;
}

export function resolveSpecifier(
  fromPath: string,
  specifier: string,
  files: Record<string, ProjectFile>,
): Resolution {
  if (specifier.startsWith("data:")) return { kind: "data", url: specifier };

  const builtin = BARE_BUILTINS[specifier];
  if (builtin) return { kind: "builtin", name: builtin };

  if (!isRelativeSpecifier(specifier)) {
    throw new LoadError(`Unsupported import '${specifier}' in file ${fromPath}`, fromPath);
  }

  const target = resolveRelative(fromPath, specifier);
  if (RUNTIME_ALIAS_FILE.test(target)) return { kind: "builtin", name: "runtime" };

  for (const candidate of candidatePaths(target)) {
    const file = files[candidate];
    if (file) return { kind: "file", path: candidate, file };
  }
  throw new LoadError(`Cannot find module '${specifier}' imported from ${fromPath}`, fromPath);
}

/**
 * Validation of Claude's structured output before it reaches the editor
 * (CONTRACTS §5).
 *
 * - scope "layer": the code must be exactly one JSX element; it is spliced into
 *   a copy of the entry file with `replaceLayerSource` (which forces the
 *   selected `data-layer-id` back onto the root) and the result must still
 *   `parseScene`. The canonical element text is read back with `getLayerSource`.
 * - scope "scene" | "new": the code must contain exactly one <Stage>, parse
 *   after `ensureLayerIds`, and have at least one layer.
 * - every source (code and helper files) must only import allowed modules and
 *   must not call wall-clock / random APIs that break "pure function of time".
 *
 * Every failure is returned as a plain-English error string that is fed back
 * to the model for the single retry.
 */
import { ParseError, ensureLayerIds, getLayerSource, parseScene, replaceLayerSource } from "@/lib/parser";
import type { AiScope } from "@/lib/types";
import type { AiOutput, AiOutputFile } from "./schema";

/** Bare module specifiers a project file may import (CONTRACTS §1). */
export const ALLOWED_BARE_IMPORTS: ReadonlySet<string> = new Set([
  "react",
  "react-dom",
  "react-dom/client",
  "lucide-react",
  "three",
  "@motion/runtime",
  "motion-runtime",
]);

/** Matches `import x from "m"`, `import { a } from "m"`, `import "m"`, `import type … from "m"` (multi-line ok). */
const STATIC_IMPORT_RE = /\bimport\s+(?:type\s+)?(?:[\w$*{}\s,]+?\s+from\s+)?["']([^"']+)["']/g;
/** Matches `export * from "m"` and `export { a } from "m"`. */
const REEXPORT_RE = /\bexport\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+["']([^"']+)["']/g;
/** Matches `require("m")` and dynamic `import("m")`. */
const CALL_IMPORT_RE = /\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g;

/** APIs that make the picture depend on something other than the seeked time (incl. three.js render loops). */
const FORBIDDEN_CALL_RE =
  /\b(Math\.random|Date\.now|performance\.now|setTimeout|setInterval|requestAnimationFrame|setAnimationLoop)\s*\(/g;

/** `styles.css`, `components/Card.jsx` — no leading slash, no `..`, no backslashes, no empty segments. */
const SAFE_RELATIVE_PATH_RE = /^(?!\.\.?(?:\/|$))[\w.\-]+(?:\/(?!\.\.?(?:\/|$))[\w.\-]+)*$/;

const SOURCE_FILE_RE = /\.(?:jsx?|tsx?)$/;

export function isAllowedImport(specifier: string): boolean {
  return ALLOWED_BARE_IMPORTS.has(specifier) || specifier.startsWith("./") || specifier.startsWith("../");
}

/** Every import specifier (static, re-export, require, dynamic import) that is not allowed, deduplicated. */
export function findDisallowedImports(source: string): string[] {
  const found = new Set<string>();
  for (const re of [STATIC_IMPORT_RE, REEXPORT_RE, CALL_IMPORT_RE]) {
    for (const match of source.matchAll(re)) {
      const specifier = match[1];
      if (!isAllowedImport(specifier)) found.add(specifier);
    }
  }
  return [...found];
}

/** Calls of `Math.random`, `Date.now`, `performance.now`, timers, `requestAnimationFrame`, `setAnimationLoop`, deduplicated. */
export function findForbiddenCalls(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(FORBIDDEN_CALL_RE)) found.add(match[1]);
  return [...found];
}

/**
 * Remove a surrounding Markdown code fence (```jsx … ```) that models
 * occasionally add despite instructions; everything else is left untouched.
 */
export function stripCodeFence(code: string): string {
  const trimmed = code.trim();
  const match = /^```[\w-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/.exec(trimmed);
  return match ? match[1] : trimmed;
}

export interface ValidationContext {
  scope: AiScope;
  /** path of the entry file inside the project */
  entryPath: string;
  /** current entry source; required for scope "layer" */
  entrySource?: string;
  /** required for scope "layer" */
  layerId?: string;
}

export type ValidationResult =
  | { ok: true; layerCode?: string; sceneCode?: string; files?: AiOutputFile[] }
  | { ok: false; error: string };

function describeError(err: unknown): string {
  if (err instanceof ParseError) {
    const where = err.line !== undefined ? ` (line ${err.line}${err.column !== undefined ? `:${err.column}` : ""})` : "";
    return `${err.message}${where}`;
  }
  return err instanceof Error ? err.message : String(err);
}

function sourceRuleErrors(label: string, source: string): string[] {
  const errors: string[] = [];
  const imports = findDisallowedImports(source);
  if (imports.length) errors.push(`${label} imports disallowed module(s): ${imports.map((s) => `"${s}"`).join(", ")}`);
  const calls = findForbiddenCalls(source);
  if (calls.length) errors.push(`${label} uses forbidden time/random API(s): ${calls.join(", ")}`);
  return errors;
}

function validateFiles(files: AiOutputFile[] | undefined, entryPath: string): { files?: AiOutputFile[]; errors: string[] } {
  const errors: string[] = [];
  const cleaned: AiOutputFile[] = [];
  for (const file of files ?? []) {
    const path = file.path.trim();
    if (!SAFE_RELATIVE_PATH_RE.test(path)) {
      errors.push(`files[].path "${file.path}" is not a safe relative project path`);
      continue;
    }
    if (path === entryPath) {
      errors.push(`files[] must not contain the entry file "${entryPath}" — put it in \`code\``);
      continue;
    }
    if (SOURCE_FILE_RE.test(path)) errors.push(...sourceRuleErrors(`File "${path}"`, file.content));
    cleaned.push({ path, content: file.content });
  }
  return { files: cleaned.length ? cleaned : undefined, errors };
}

function validateLayer(code: string, ctx: ValidationContext): ValidationResult {
  if (ctx.entrySource === undefined || !ctx.layerId) {
    return { ok: false, error: 'scope "layer" needs the entry source and a layerId' };
  }
  let next: string;
  try {
    next = replaceLayerSource(ctx.entrySource, ctx.layerId, code);
  } catch (err) {
    return { ok: false, error: `The layer code could not be spliced into the scene: ${describeError(err)}` };
  }
  try {
    const scene = parseScene(next);
    if (!scene.byId[ctx.layerId]) {
      return { ok: false, error: `The layer with data-layer-id="${ctx.layerId}" disappeared after the replacement` };
    }
  } catch (err) {
    return { ok: false, error: `The scene no longer parses after the replacement: ${describeError(err)}` };
  }
  return { ok: true, layerCode: getLayerSource(next, ctx.layerId) };
}

function validateScene(code: string): ValidationResult {
  let source: string;
  try {
    source = ensureLayerIds(code).source;
  } catch (err) {
    return { ok: false, error: `The entry file does not parse: ${describeError(err)}` };
  }
  let layerCount: number;
  try {
    layerCount = parseScene(source).layers.length;
  } catch (err) {
    return { ok: false, error: `The entry file does not parse: ${describeError(err)}` };
  }
  if (layerCount === 0) return { ok: false, error: "The <Stage> has no layers; add at least one <Sprite>" };
  if (!/\bexport\s+default\b/.test(source) && !/\b(?:createRoot|ReactDOM\.render)\s*\(/.test(source)) {
    return { ok: false, error: "The entry file must `export default` the scene component" };
  }
  return { ok: true, sceneCode: source };
}

/** Validate Claude's output for the given scope; on success returns the canonical code to apply. */
export function validateAiOutput(output: AiOutput, ctx: ValidationContext): ValidationResult {
  const code = stripCodeFence(output.code);
  const errors: string[] = [];
  if (!code) errors.push("`code` is empty");
  if (!output.summary.trim()) errors.push("`summary` is empty");
  errors.push(...sourceRuleErrors("`code`", code));
  const filesResult = validateFiles(output.files, ctx.entryPath);
  errors.push(...filesResult.errors);
  if (errors.length) return { ok: false, error: errors.join("; ") };

  const result = ctx.scope === "layer" ? validateLayer(code, ctx) : validateScene(code);
  if (!result.ok) return result;
  return filesResult.files ? { ...result, files: filesResult.files } : result;
}

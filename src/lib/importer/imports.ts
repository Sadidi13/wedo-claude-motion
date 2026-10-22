/**
 * Import-declaration merging for assembled scene files.
 *
 * Several `<script>` blocks concatenated into one module often repeat
 * `import React from "react"` or import the runtime twice; an ES module may
 * bind a name only once, so the assembler strips every import and re-emits
 * one declaration per module (first-appearance order) — but only when
 * something actually has to change (`MergeResult.changed`), so a clean
 * scene.jsx keeps its import lines byte-for-byte. CDN URLs for the packages
 * the loader provides are normalised to their bare names, and the runtime is
 * always referenced as "./animations.jsx".
 */
import type { ImportInfo, ImportSpecifierInfo } from "./ast";

export const RUNTIME_SPECIFIER = "./animations.jsx";

/** Modules the loader resolves (CONTRACTS §1); anything else cannot load. */
const PROVIDED_MODULES = new Set(["react", "react-dom", "react-dom/client", "lucide-react", RUNTIME_SPECIFIER]);

export interface MergedImport {
  source: string;
  defaultName?: string;
  namespace?: string;
  /** local name → imported name, insertion ordered (locals are unique within a module) */
  named: Map<string, string>;
}

const URL_PACKAGES: { pattern: RegExp; name: string }[] = [
  { pattern: /\/react-dom(@[^/]*)?\/client(\/|\?|$)/, name: "react-dom/client" },
  { pattern: /\/react-dom(@[^/]*)?(\/|\?|$)/, name: "react-dom" },
  { pattern: /\/react(@[^/]*)?(\/|\?|$)/, name: "react" },
  { pattern: /\/lucide-react(@[^/]*)?(\/|\?|$)/, name: "lucide-react" },
];

const RUNTIME_SOURCE = /^(?:\.\/|\/)?(?:src\/)?animations(?:\.(?:jsx|js|tsx|ts))?$|^(?:@motion\/runtime|motion-runtime)$/;

/**
 * Map an import source to what the loader understands:
 * `https://esm.sh/react@19` → "react", `animations.jsx` → "./animations.jsx".
 * Returns the source unchanged (and `supported: false`) for anything the loader
 * cannot resolve so the caller can warn.
 */
export function normaliseImportSource(source: string): { source: string; supported: boolean } {
  if (RUNTIME_SOURCE.test(source)) return { source: RUNTIME_SPECIFIER, supported: true };
  if (/^(https?:)?\/\//.test(source)) {
    for (const { pattern, name } of URL_PACKAGES) {
      if (pattern.test(source)) return { source: name, supported: true };
    }
    return { source, supported: false };
  }
  if (source.startsWith("./") || source.startsWith("../") || source.startsWith("/")) return { source, supported: true };
  return { source, supported: PROVIDED_MODULES.has(source) };
}

export interface MergeResult {
  imports: MergedImport[];
  /** sources the loader will reject, in first-appearance order */
  unsupported: string[];
  /** the original declarations must be replaced (duplicates, rewritten sources, dropped specifiers) */
  changed: boolean;
}

/**
 * Merge runtime imports by (normalised) source. A local name may be bound
 * only once: later specifiers that would re-bind an existing local are
 * dropped. Type-only imports are omitted (sucrase strips them anyway).
 */
export function mergeImports(imports: readonly ImportInfo[]): MergeResult {
  const bySource = new Map<string, MergedImport>();
  const locals = new Set<string>();
  const unsupported: string[] = [];
  let changed = false;

  const bind = (local: string): boolean => {
    if (locals.has(local)) {
      changed = true;
      return false;
    }
    locals.add(local);
    return true;
  };

  for (const info of imports) {
    if (info.typeOnly) continue;
    const { source, supported } = normaliseImportSource(info.source);
    if (source !== info.source) changed = true;
    if (!supported && !unsupported.includes(source)) unsupported.push(source);
    let merged = bySource.get(source);
    if (!merged) {
      merged = { source, named: new Map() };
      bySource.set(source, merged);
    } else {
      changed = true;
    }
    if (info.defaultName && bind(info.defaultName)) merged.defaultName ??= info.defaultName;
    if (info.namespace && bind(info.namespace)) merged.namespace ??= info.namespace;
    for (const spec of info.named) addNamed(merged, spec, bind);
  }
  return { imports: [...bySource.values()], unsupported, changed };
}

function addNamed(merged: MergedImport, spec: ImportSpecifierInfo, bind: (local: string) => boolean): void {
  if (!bind(spec.local)) return;
  merged.named.set(spec.local, spec.imported);
}

/** True when `local` is bound by any of the merged imports. */
export function bindsLocal(imports: readonly MergedImport[], local: string): boolean {
  return imports.some((i) => i.defaultName === local || i.namespace === local || i.named.has(local));
}

function entryFor(imports: MergedImport[], source: string): MergedImport {
  let merged = imports.find((i) => i.source === source);
  if (!merged) {
    merged = { source, named: new Map() };
    imports.push(merged);
  }
  return merged;
}

/** Ensure `import { names } from source` exists in `target` (skipping names already bound anywhere in `bound`). */
export function ensureNamedImport(
  target: MergedImport[],
  bound: readonly MergedImport[],
  source: string,
  names: readonly string[],
): void {
  const missing = names.filter((name) => !bindsLocal(bound, name) && !bindsLocal(target, name));
  if (!missing.length) return;
  const merged = entryFor(target, source);
  for (const name of missing) merged.named.set(name, name);
}

/** Ensure `import Name from source` exists in `target`. */
export function ensureDefaultImport(target: MergedImport[], bound: readonly MergedImport[], source: string, name: string): void {
  if (bindsLocal(bound, name) || bindsLocal(target, name)) return;
  const merged = entryFor(target, source);
  merged.defaultName ??= name;
}

/** Render merged imports as source lines (one `import` per module, namespace imports on their own line). */
export function renderImports(imports: readonly MergedImport[]): string {
  const lines: string[] = [];
  for (const { source, defaultName, namespace, named } of imports) {
    const from = JSON.stringify(source);
    const specifiers = [...named].map(([local, imported]) => (imported === local ? imported : `${imported} as ${local}`));
    const clauses: string[] = [];
    if (defaultName) clauses.push(defaultName);
    if (specifiers.length) clauses.push(`{ ${specifiers.join(", ")} }`);
    if (clauses.length) lines.push(`import ${clauses.join(", ")} from ${from};`);
    if (namespace) lines.push(`import * as ${namespace} from ${from};`);
    if (!clauses.length && !namespace) lines.push(`import ${from};`);
  }
  return lines.join("\n");
}

/**
 * Mini CommonJS module system for project files (CONTRACTS.md §3).
 *
 * Each source file is asset-rewritten, compiled with sucrase and evaluated as
 * `new Function("require", "module", "exports", "React", code)`. Modules are
 * cached by normalised path; an import cycle throws a LoadError naming the
 * chain. CSS files are handed to `injectCss` once and export `{}`; assets
 * export their data URL string; JSON files export the parsed value.
 *
 * No DOM access here (the CSS injector is supplied by the caller) so the whole
 * thing is unit-testable in node.
 */

import type { ProjectFile } from "@/lib/types";
import { collectAssets, rewriteAssetReferences, rewriteCssAssetReferences } from "./assets";
import { compileFile } from "./compile";
import { LoadError } from "./errors";
import { resolveSpecifier, type BuiltinName } from "./resolve";

export type RequireFn = (specifier: string) => unknown;

export interface ModuleSystemOptions {
  /** project files keyed by normalised path (see buildFileTable) */
  files: Record<string, ProjectFile>;
  /** host modules returned for bare builtin specifiers */
  builtins: Record<BuiltinName, unknown>;
  /** the value bound to the `React` free variable in every module (classic JSX runtime) */
  react: unknown;
  injectCss: (path: string, css: string) => void;
}

export interface ModuleSystem {
  /** Evaluate (or return the cached) module at `path` and return its `module.exports`. */
  load(path: string): unknown;
}

interface ModuleRecord {
  exports: unknown;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createModuleSystem(options: ModuleSystemOptions): ModuleSystem {
  const { files, builtins, react, injectCss } = options;
  const assets = collectAssets(files);
  const cache = new Map<string, ModuleRecord>();
  const loading: string[] = [];

  const requireFrom = (fromPath: string, specifier: string): unknown => {
    const resolution = resolveSpecifier(fromPath, specifier, files);
    switch (resolution.kind) {
      case "data":
        return resolution.url;
      case "builtin":
        return builtins[resolution.name];
      case "file":
        return loadFile(resolution.path, resolution.file);
    }
  };

  const evaluateSource = (path: string, file: ProjectFile): ModuleRecord => {
    const code = compileFile(path, rewriteAssetReferences(file.content, path, assets));
    let factory: (require: RequireFn, module: ModuleRecord, exports: unknown, React: unknown) => void;
    try {
      factory = new Function("require", "module", "exports", "React", code) as typeof factory;
    } catch (error) {
      throw new LoadError(`${path}: ${describe(error)}`, path, { cause: error });
    }
    const record: ModuleRecord = { exports: {} };
    loading.push(path);
    try {
      factory((specifier) => requireFrom(path, specifier), record, record.exports, react);
    } catch (error) {
      if (error instanceof LoadError) throw error;
      throw new LoadError(`Error evaluating ${path}: ${describe(error)}`, path, { cause: error });
    } finally {
      loading.pop();
    }
    return record;
  };

  const loadFile = (path: string, file: ProjectFile): unknown => {
    const cached = cache.get(path);
    if (cached) return cached.exports;
    if (loading.includes(path)) {
      throw new LoadError(`Circular import: ${[...loading, path].join(" -> ")}`, path);
    }

    let record: ModuleRecord;
    switch (file.kind) {
      case "css":
        injectCss(path, rewriteCssAssetReferences(file.content, path, assets));
        record = { exports: {} };
        break;
      case "asset":
        record = { exports: file.content };
        break;
      case "json":
        try {
          record = { exports: JSON.parse(file.content) };
        } catch (error) {
          throw new LoadError(`${path}: invalid JSON (${describe(error)})`, path, { cause: error });
        }
        break;
      case "html":
        throw new LoadError(`Cannot import HTML file '${path}' (HTML entries are converted by the importer)`, path);
      default:
        record = evaluateSource(path, file);
    }
    cache.set(path, record);
    return record.exports;
  };

  return {
    load(path) {
      const file = files[path];
      if (!file) throw new LoadError(`Entry file '${path}' not found in project`, path);
      return loadFile(path, file);
    },
  };
}

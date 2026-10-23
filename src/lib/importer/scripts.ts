/**
 * Classifies the <script> tags of an imported page (CONTRACTS §7):
 *
 *   inline text/babel | text/jsx | typescript          → scene code
 *   inline (no type | javascript | module) with React  → scene code
 *   inline plain JavaScript / data blocks              → skipped (+ warning)
 *   external React / ReactDOM / Babel / runtime CDN    → dropped (we provide them)
 *   external three.js main build (global THREE)        → dropped (provided; the
 *                                                        assembler imports it)
 *   external relative file present in the archive      → inlined into the scene
 *   other external scripts                             → dropped with a warning
 *
 * Every inline body is also scanned for `window.__videoMeta = {…}`.
 */
import type { ProjectFile } from "@/lib/types";
import { isSourceKind, normaliseProjectPath } from "./files";
import type { ScriptBlock } from "./htmlExtract";
import { readVideoMeta, type MetaHints } from "./meta";

const JSX_TYPES = new Set(["text/babel", "text/jsx", "text/typescript", "text/tsx", "application/typescript"]);
const JS_TYPES = new Set(["", "text/javascript", "application/javascript", "application/ecmascript", "text/ecmascript", "module"]);
const DATA_TYPES = new Set(["importmap", "application/json", "application/ld+json", "speculationrules"]);

/** URLs of packages the loader provides itself. */
const PROVIDED_CDN = /\b(react|react-dom|babel|animations|motion-runtime)\b/i;
/** The three.js main build (`…/three@x/build/three(.module)(.min).js`); addons are not provided. */
const THREE_CDN = /\/three(@[^/?#]*)?\/build\/three(\.module)?(\.min)?\.js([?#].*)?$/i;
/** The runtime file next to the page; the loader aliases every spelling of it. */
const RUNTIME_FILE = /(^|\/)animations(\.(jsx|js|tsx|ts))?$/;
const REACT_HINTS =
  /\bReact(DOM)?\b|\bcreateRoot\b|\buse(State|Effect|Memo|Ref|Time|Sprite|Timeline|Stage)\b|<[A-Z][\w.]*[\s/>]|<(div|span|svg|section|main|h[1-6]|p|img|button)\b[^>]*>/;
/** `window.__videoMeta = {…};` and nothing else */
const ONLY_META = /^\s*(window\.)?__videoMeta\s*=\s*\{[^}]*\}\s*;?\s*$/;

export interface SceneScripts {
  /** inline / inlined script bodies joined in document order */
  code: string;
  /** first `window.__videoMeta` assignment found in any inline script */
  videoMeta: MetaHints;
}

function scriptType(attrs: Record<string, string>): string {
  return (attrs.type ?? "").split(";")[0].trim().toLowerCase();
}

function collectExternal(src: string, files: Record<string, ProjectFile>, parts: string[], warnings: string[]): void {
  if (/^(https?:)?\/\//i.test(src)) {
    if (PROVIDED_CDN.test(src) || THREE_CDN.test(src)) return;
    warnings.push(
      `External script "${src}" was dropped; Motion Studio provides React, Babel, three.js and the Motion runtime itself`,
    );
    return;
  }
  const path = normaliseProjectPath(src.split(/[?#]/)[0]);
  if (RUNTIME_FILE.test(path)) return;
  const file = files[path];
  if (file && isSourceKind(file.kind)) {
    parts.push(file.content);
    delete files[path];
    return;
  }
  warnings.push(`Script "${src}" referenced by the page was not found in the archive`);
}

/**
 * Gather the scene code from the page's scripts. Relative `<script src>`
 * files that exist in `files` are inlined and removed from the table.
 */
export function collectSceneScripts(
  scripts: readonly ScriptBlock[],
  files: Record<string, ProjectFile>,
  warnings: string[],
): SceneScripts {
  const parts: string[] = [];
  let videoMeta: MetaHints = {};

  scripts.forEach((script, index) => {
    const src = script.attrs.src?.trim();
    if (src) {
      collectExternal(src, files, parts, warnings);
      return;
    }
    const body = script.body;
    if (!body.trim()) return;
    if (!Object.keys(videoMeta).length) videoMeta = readVideoMeta(body);

    const type = scriptType(script.attrs);
    if (DATA_TYPES.has(type)) return;
    const reactLike = REACT_HINTS.test(body);
    if (JSX_TYPES.has(type) || (JS_TYPES.has(type) && reactLike)) {
      parts.push(body);
      return;
    }
    if (JS_TYPES.has(type)) {
      if (!ONLY_META.test(body)) {
        warnings.push(
          `Inline script #${index + 1} is plain JavaScript without React and was not imported (scenes must be a pure function of time)`,
        );
      }
      return;
    }
    warnings.push(`Inline <script type="${type}"> #${index + 1} was not imported`);
  });

  return { code: parts.join("\n\n"), videoMeta };
}

/**
 * Rewrites relative asset references to data URLs before a file is compiled
 * (CONTRACTS.md §1 "Assets are referenced by relative path").
 *
 * Kept deliberately simple and textual:
 *   - JS/JSX/TS: every *quoted string literal* that is exactly one of the
 *     spellings of an asset path ("assets/logo.png", "./assets/logo.png",
 *     "/assets/logo.png" or the path relative to the importing file) becomes
 *     the asset's data URL. That covers `src="assets/x.png"`, `src={"./x.png"}`
 *     and `import x from "./assets/x.png"` (the resolver accepts data: URLs).
 *   - CSS: the same inside `url(...)`, quoted or not.
 * Template literals with interpolation and paths built at runtime are not rewritten.
 */

import type { ProjectFile } from "@/lib/types";
import { normalisePath, relativeSpecifier } from "./paths";

export interface AssetRef {
  /** normalised project path, e.g. "assets/logo.png" */
  path: string;
  dataUrl: string;
}

export function collectAssets(files: Record<string, ProjectFile>): AssetRef[] {
  return Object.values(files)
    .filter((file) => file.kind === "asset")
    .map((file) => ({ path: normalisePath(file.path), dataUrl: file.content }));
}

/** All spellings of `assetPath` that may appear inside `fromPath`. */
export function assetReferenceVariants(assetPath: string, fromPath: string): string[] {
  const variants = new Set<string>([assetPath, `./${assetPath}`, `/${assetPath}`, relativeSpecifier(fromPath, assetPath)]);
  return [...variants];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function rewriteAssetReferences(source: string, fromPath: string, assets: AssetRef[]): string {
  let out = source;
  for (const asset of assets) {
    for (const variant of assetReferenceVariants(asset.path, fromPath)) {
      const pattern = new RegExp(`(["'\`])${escapeRegExp(variant)}\\1`, "g");
      out = out.replace(pattern, (_match, quote: string) => `${quote}${asset.dataUrl}${quote}`);
    }
  }
  return out;
}

export function rewriteCssAssetReferences(css: string, fromPath: string, assets: AssetRef[]): string {
  let out = css;
  for (const asset of assets) {
    for (const variant of assetReferenceVariants(asset.path, fromPath)) {
      const pattern = new RegExp(`url\\(\\s*(["']?)${escapeRegExp(variant)}\\1\\s*\\)`, "g");
      out = out.replace(pattern, () => `url("${asset.dataUrl}")`);
    }
  }
  return out;
}

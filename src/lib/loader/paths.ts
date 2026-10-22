/**
 * Posix-style path helpers for project-relative paths ("scene.jsx",
 * "components/Card.jsx", "assets/logo.png"). Pure, no node:path dependency so
 * the same code runs in the browser.
 */

export const SOURCE_EXTENSIONS = [".jsx", ".js", ".tsx", ".ts"] as const;

/** Collapse "./", "../", duplicate and leading slashes: "./a/../b//c.jsx" -> "b/c.jsx". */
export function normalisePath(path: string): string {
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

/** Directory part of a normalised path; "" for files at the project root. */
export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  return i <= 0 ? "" : base.slice(i).toLowerCase();
}

/** "./x", "../x" and root-absolute "/x" specifiers point at project files. */
export function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
}

/** Resolve a relative specifier against the importing file: ("components/Card.jsx", "../styles.css") -> "styles.css". */
export function resolveRelative(fromPath: string, specifier: string): string {
  if (specifier.startsWith("/")) return normalisePath(specifier);
  return normalisePath(`${dirname(normalisePath(fromPath))}/${specifier}`);
}

/** Paths to probe for a resolved specifier, in order: as written, with each source extension, then index files. */
export function candidatePaths(path: string): string[] {
  const candidates = [path];
  for (const ext of SOURCE_EXTENSIONS) candidates.push(`${path}${ext}`);
  for (const ext of SOURCE_EXTENSIONS) candidates.push(`${path}/index${ext}`);
  return candidates;
}

/** The relative specifier that reaches `target` from `fromPath` ("components/Card.jsx" -> "assets/a.png" = "../assets/a.png"). */
export function relativeSpecifier(fromPath: string, target: string): string {
  const fromParts = dirname(normalisePath(fromPath)).split("/").filter(Boolean);
  const targetParts = normalisePath(target).split("/");
  let common = 0;
  while (common < fromParts.length && common < targetParts.length - 1 && fromParts[common] === targetParts[common]) {
    common++;
  }
  const ups = fromParts.length - common;
  const rest = targetParts.slice(common).join("/");
  return ups === 0 ? `./${rest}` : `${"../".repeat(ups)}${rest}`;
}

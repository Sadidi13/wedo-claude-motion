/**
 * compileFile — sucrase transform of one project source file to CommonJS
 * (CONTRACTS.md §3): JSX (classic runtime, `React.createElement`), TypeScript
 * stripped, ESM imports/exports turned into `require` / `exports`.
 */

import { transform } from "sucrase";
import { LoadError } from "./errors";

export function compileFile(path: string, source: string): string {
  try {
    return transform(source, {
      transforms: ["jsx", "typescript", "imports"],
      jsxRuntime: "classic",
      production: true,
      filePath: path,
      // The TypeScript transform would otherwise drop imports whose binding is unused
      // (e.g. `import styles from "./styles.css"`); side effects must survive.
      keepUnusedImports: true,
    }).code;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new LoadError(message.includes(path) ? message : `${path}: ${message}`, path, { cause: error });
  }
}

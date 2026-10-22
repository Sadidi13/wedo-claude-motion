/**
 * Public API of the loader (CONTRACTS.md §3):
 *
 *   loadProject(project, mount, opts?)  evaluate + mount a Project in the browser
 *   compileFile(path, source)           sucrase: jsx + typescript + imports -> CommonJS
 *   LoadError                           error type with the offending `file`
 */

export { compileFile } from "./compile";
export { LoadError } from "./errors";
export { loadProject } from "./render";
export type { LoadErrorInfo, LoadOptions, LoadResult } from "./render";

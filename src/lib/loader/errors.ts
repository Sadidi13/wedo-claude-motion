/**
 * LoadError — the single error type the loader throws (CONTRACTS.md §3).
 * `file` is the project-relative path of the file being compiled / resolved
 * / evaluated when the error happened, when known.
 */

export class LoadError extends Error {
  file?: string;

  constructor(message: string, file?: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LoadError";
    this.file = file;
  }
}

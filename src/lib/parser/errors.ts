/**
 * ParseError — the single error type the parser module throws for malformed
 * input (a file or JSX fragment that Babel cannot parse, a file without a
 * <Stage>, a replacement that is not exactly one JSX element, ...).
 *
 * `line` is 1-based and `column` is 0-based, exactly as Babel reports them and
 * as they appear in Babel's "(line:column)" message suffix.
 */
export class ParseError extends Error {
  line?: number;
  column?: number;

  constructor(message: string, loc?: { line?: number; column?: number }) {
    super(message);
    this.name = "ParseError";
    if (loc?.line !== undefined) this.line = loc.line;
    if (loc?.column !== undefined) this.column = loc.column;
  }
}

/**
 * Convert anything thrown by Babel into a ParseError, carrying the location
 * from Babel's SyntaxError (`err.loc = { line, column }`) when present.
 */
export function toParseError(err: unknown): ParseError {
  if (err instanceof ParseError) return err;
  const e = err as { message?: unknown; loc?: { line?: unknown; column?: unknown } } | null;
  const message = typeof e?.message === "string" ? e.message : String(err);
  const line = typeof e?.loc?.line === "number" ? e.loc.line : undefined;
  const column = typeof e?.loc?.column === "number" ? e.loc.column : undefined;
  return new ParseError(message, { line, column });
}

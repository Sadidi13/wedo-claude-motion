/**
 * Pure string helpers used by every edit operation: batched offset-based
 * splices, line / indentation lookups, re-indentation of inserted snippets and
 * literal formatting. Nothing here knows about Babel.
 */

export interface TextEdit {
  /** 0-based inclusive start offset of the replaced range (start === end ⇒ insertion) */
  start: number;
  /** 0-based exclusive end offset of the replaced range */
  end: number;
  text: string;
}

/**
 * Apply non-overlapping edits computed against the SAME original string.
 * Edits are applied back-to-front so earlier offsets stay valid; insertions at
 * the same offset keep their array order.
 */
export function applyEdits(source: string, edits: readonly TextEdit[]): string {
  // Ascending order, one pass, so a file with thousands of edits (every element
  // of a freshly imported scene gets an id) is copied once rather than per edit.
  const ordered = edits
    .map((edit, index) => ({ edit, index }))
    .sort((a, b) => a.edit.start - b.edit.start || a.edit.end - b.edit.end || a.index - b.index);
  const parts: string[] = [];
  let cursor = 0;
  for (const { edit } of ordered) {
    if (edit.start < cursor) throw new Error("Overlapping text edits");
    parts.push(source.slice(cursor, edit.start), edit.text);
    cursor = edit.end;
  }
  parts.push(source.slice(cursor));
  return parts.join("");
}

/** Replace `[start, end)` with `text`. */
export function splice(source: string, start: number, end: number, text: string): string {
  return source.slice(0, start) + text + source.slice(end);
}

/** Offset of the first character of the line containing `offset`. */
export function lineStartOf(source: string, offset: number): number {
  const nl = source.lastIndexOf("\n", offset - 1);
  return nl === -1 ? 0 : nl + 1;
}

/** Offset of the "\n" ending the line containing `offset` (or source.length). */
export function lineEndOf(source: string, offset: number): number {
  const nl = source.indexOf("\n", offset);
  return nl === -1 ? source.length : nl;
}

/** Leading whitespace of the line containing `offset`. */
export function indentAt(source: string, offset: number): string {
  const line = source.slice(lineStartOf(source, offset), lineEndOf(source, offset));
  return /^[ \t]*/.exec(line)?.[0] ?? "";
}

/** True when only whitespace precedes `offset` on its line. */
export function startsLine(source: string, offset: number): boolean {
  return /^[ \t]*$/.test(source.slice(lineStartOf(source, offset), offset));
}

/** True when only whitespace follows `offset` on its line. */
export function endsLine(source: string, offset: number): boolean {
  return /^[ \t\r]*$/.test(source.slice(offset, lineEndOf(source, offset)));
}

/** Line terminator used by the file ("\r\n" when the file is CRLF, else "\n"). */
export function eolOf(source: string): string {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Re-indent a (possibly multi-line) JSX snippet so that every line after the
 * first starts with `indent` plus the snippet's own relative indentation.
 * The first line is returned trimmed: callers place it after the indentation
 * that already exists in the file at the insertion point.
 */
export function reindent(snippet: string, indent: string, eol = "\n"): string {
  const lines = snippet.replace(/\r\n/g, "\n").trim().split("\n");
  if (lines.length === 1) return lines[0];
  const rest = lines.slice(1);
  let common = Infinity;
  for (const line of rest) {
    if (line.trim() === "") continue;
    common = Math.min(common, /^[ \t]*/.exec(line)?.[0].length ?? 0);
  }
  const base = Number.isFinite(common) ? common : 0;
  const body = rest.map((line) => (line.trim() === "" ? "" : indent + line.slice(base)));
  return [lines[0], ...body].join(eol);
}

/**
 * Format a number as a JS literal with at most 3 decimals and no trailing
 * zeros (1.5 → "1.5", 4 → "4", 0.1 + 0.2 → "0.3"). Infinity is written as the
 * `Infinity` identifier, which the runtime accepts as an open-ended `end`.
 */
export function formatNumber(n: number): string {
  if (Number.isNaN(n)) throw new Error("Cannot write NaN as a numeric literal");
  if (!Number.isFinite(n)) return n > 0 ? "Infinity" : "-Infinity";
  return String(Number(n.toFixed(3)));
}

/** Escape a string for use inside a double-quoted JSX attribute value. */
export function escapeJsxAttr(value: string): string {
  return value.replace(/"/g, "&quot;");
}

/** HTTP Range parsing for the media preview route (browsers seek a <video> with range requests). */

/** `bytes=a-b` / `bytes=a-` / `bytes=-n` → inclusive [start, end], or null when unusable. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
}

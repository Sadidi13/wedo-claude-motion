/**
 * Time / frame helpers shared by the store, the timeline and the inspector:
 * frame snapping, "mm:ss:ff" timecodes, range badges and the pure clip-drag
 * arithmetic the Timeline commits through `setTiming`. No DOM, fully tested.
 */

/** Round `t` to the nearest frame boundary at `fps`. */
export function snapToFrame(t: number, fps: number): number {
  if (!(fps > 0)) return t;
  return Math.round(t * fps) / fps;
}

/** Seconds → whole frame index (rounded). */
export function toFrame(t: number, fps: number): number {
  return Math.round(t * fps);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** "mm:ss:ff" for the transport readout. */
export function formatTimecode(t: number, fps: number): string {
  const safe = Number.isFinite(t) && t > 0 ? t : 0;
  const totalFrames = Math.round(safe * fps);
  const framesPerMinute = fps * 60;
  const minutes = Math.floor(totalFrames / framesPerMinute);
  const seconds = Math.floor((totalFrames % framesPerMinute) / fps);
  const frames = totalFrames % fps;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
}

/** Compact seconds label: 0.5 → "0.5", 4 → "4", Infinity → "∞". */
export function formatSeconds(t: number, decimals = 2): string {
  if (!Number.isFinite(t)) return "∞";
  const rounded = Number(t.toFixed(decimals));
  return String(rounded);
}

/** Timing badge for a layer row, e.g. "0.5–4s". */
export function formatRange(range: { start: number; end: number }): string {
  return `${formatSeconds(range.start)}–${formatSeconds(range.end)}s`;
}

export type ClipDragMode = "move" | "trim-start" | "trim-end";

export interface ClipDragInput {
  mode: ClipDragMode;
  /** clip timing before the drag */
  start: number;
  end: number;
  /** pointer delta in seconds (positive = later) */
  delta: number;
  /** allowed window (parent range ∩ [0, duration]) */
  bounds: { start: number; end: number };
  fps: number;
}

/**
 * Resolve a timeline drag into a new `{start, end}`: snapped to frames, never
 * shorter than one frame and always inside `bounds`. A move keeps the length.
 */
export function resolveClipDrag(input: ClipDragInput): { start: number; end: number } {
  const { mode, bounds, fps } = input;
  const frame = fps > 0 ? 1 / fps : 0.001;
  const length = Math.max(frame, input.end - input.start);
  const lo = Math.max(0, bounds.start);
  const hi = Number.isFinite(bounds.end) ? bounds.end : Math.max(input.end, lo + length);

  if (mode === "move") {
    const maxStart = Math.max(lo, hi - length);
    const start = snapToFrame(clamp(input.start + input.delta, lo, maxStart), fps);
    return { start, end: snapToFrame(start + length, fps) };
  }
  if (mode === "trim-start") {
    const start = snapToFrame(clamp(input.start + input.delta, lo, input.end - frame), fps);
    return { start, end: input.end };
  }
  const end = snapToFrame(clamp(input.end + input.delta, input.start + frame, hi), fps);
  return { start: input.start, end };
}

/**
 * Pixels-per-second zoom → ruler label step in seconds so labels stay at
 * least `minLabelPx` apart.
 */
export function rulerStep(pxPerSecond: number, minLabelPx = 64): number {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
  for (const step of steps) if (step * pxPerSecond >= minLabelPx) return step;
  return steps[steps.length - 1];
}

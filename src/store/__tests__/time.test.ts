import { describe, expect, it } from "vitest";
import { formatRange, formatSeconds, formatTimecode, resolveClipDrag, rulerStep, snapToFrame, toFrame } from "../time";

describe("frames + formatting", () => {
  it("snaps to the frame grid", () => {
    expect(snapToFrame(1.004, 30)).toBe(1);
    expect(snapToFrame(0.0167, 30)).toBeCloseTo(1 / 30, 9);
    expect(snapToFrame(2, 0)).toBe(2);
    expect(toFrame(1.5, 30)).toBe(45);
  });

  it("formats mm:ss:ff and seconds labels", () => {
    expect(formatTimecode(0, 30)).toBe("00:00:00");
    expect(formatTimecode(1.5, 30)).toBe("00:01:15");
    expect(formatTimecode(61 + 29 / 30, 30)).toBe("01:01:29");
    expect(formatTimecode(NaN, 30)).toBe("00:00:00");
    expect(formatSeconds(0.5)).toBe("0.5");
    expect(formatSeconds(4)).toBe("4");
    expect(formatSeconds(Infinity)).toBe("∞");
    expect(formatRange({ start: 0.5, end: 4 })).toBe("0.5–4s");
  });

  it("picks a ruler step that keeps labels apart", () => {
    expect(rulerStep(400)).toBe(0.25);
    expect(rulerStep(100)).toBe(1);
    expect(rulerStep(40)).toBe(2);
    expect(rulerStep(1)).toBe(60);
  });
});

describe("resolveClipDrag", () => {
  const fps = 30;
  const bounds = { start: 0, end: 8 };

  it("moves keeping the length, snapped and clamped to the bounds", () => {
    expect(resolveClipDrag({ mode: "move", start: 1, end: 3, delta: 0.51, bounds, fps })).toEqual({ start: 1.5, end: 3.5 });
    expect(resolveClipDrag({ mode: "move", start: 1, end: 3, delta: 10, bounds, fps })).toEqual({ start: 6, end: 8 });
    expect(resolveClipDrag({ mode: "move", start: 1, end: 3, delta: -10, bounds, fps })).toEqual({ start: 0, end: 2 });
  });

  it("trims each edge but never below one frame", () => {
    expect(resolveClipDrag({ mode: "trim-start", start: 1, end: 3, delta: 1, bounds, fps })).toEqual({ start: 2, end: 3 });
    const tiny = resolveClipDrag({ mode: "trim-start", start: 1, end: 3, delta: 5, bounds, fps });
    expect(tiny.end - tiny.start).toBeCloseTo(1 / fps, 9);
    expect(resolveClipDrag({ mode: "trim-end", start: 1, end: 3, delta: 9, bounds, fps })).toEqual({ start: 1, end: 8 });
    const short = resolveClipDrag({ mode: "trim-end", start: 1, end: 3, delta: -9, bounds, fps });
    expect(short.end - short.start).toBeCloseTo(1 / fps, 9);
  });

  it("respects a nested parent's window", () => {
    const nested = { start: 2, end: 6 };
    expect(resolveClipDrag({ mode: "move", start: 3, end: 4, delta: -5, bounds: nested, fps })).toEqual({ start: 2, end: 3 });
    expect(resolveClipDrag({ mode: "trim-end", start: 3, end: 4, delta: 5, bounds: nested, fps })).toEqual({ start: 3, end: 6 });
  });
});

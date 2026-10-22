import { describe, expect, it } from "vitest";
import {
  DEFAULT_CRF,
  frameExtFor,
  frameFileName,
  framePattern,
  frameTime,
  partitionFrames,
  resolvePlan,
  slugify,
  supportsAlpha,
} from "../plan";
import { makeProject } from "./fixtures";

describe("resolvePlan", () => {
  it("fills defaults from the stage meta", () => {
    const plan = resolvePlan(makeProject(), { format: "mp4" });
    expect(plan).toMatchObject({
      format: "mp4",
      fps: 10,
      scale: 1,
      range: { start: 0, end: 2 },
      transparent: false,
      quality: DEFAULT_CRF,
      width: 320,
      height: 180,
      outputWidth: 320,
      outputHeight: 180,
      frameCount: 20,
      frameExt: "jpg",
      outputFile: "output.mp4",
      fileName: "product-launch.mp4",
      contentType: "video/mp4",
    });
  });

  it("honours fps / scale / range / quality overrides and rounds the frame count", () => {
    const plan = resolvePlan(makeProject(), { format: "mov", fps: 24, scale: 2, range: { start: 0.5, end: 1.5 }, quality: 23 });
    expect(plan.fps).toBe(24);
    expect(plan.frameCount).toBe(24);
    expect(plan.outputWidth).toBe(640);
    expect(plan.outputHeight).toBe(360);
    expect(plan.quality).toBe(23);
    expect(plan.outputFile).toBe("output.mov");
    expect(plan.contentType).toBe("video/quicktime");
  });

  it("clamps the range to the stage duration", () => {
    const plan = resolvePlan(makeProject(), { format: "gif", range: { start: 1, end: 99 } });
    expect(plan.range).toEqual({ start: 1, end: 2 });
    expect(plan.frameCount).toBe(10);
  });

  it("rejects a range that is empty after clamping or shorter than a frame", () => {
    expect(() => resolvePlan(makeProject(), { format: "mp4", range: { start: 5, end: 6 } })).toThrow(/empty/);
    expect(() => resolvePlan(makeProject(), { format: "mp4", fps: 1, range: { start: 0, end: 0.2 } })).toThrow(/shorter/);
  });

  it("keeps alpha only for formats that can carry it", () => {
    expect(resolvePlan(makeProject(), { format: "mp4", transparent: true }).transparent).toBe(false);
    expect(resolvePlan(makeProject(), { format: "gif", transparent: true }).transparent).toBe(false);
    for (const format of ["webm", "mov", "png-sequence"] as const) {
      const plan = resolvePlan(makeProject(), { format, transparent: true });
      expect(plan.transparent).toBe(true);
      expect(plan.frameExt).toBe("png");
    }
  });

  it("always renders PNG frames for a png-sequence, even when opaque", () => {
    const plan = resolvePlan(makeProject(), { format: "png-sequence" });
    expect(plan.transparent).toBe(false);
    expect(plan.frameExt).toBe("png");
    expect(plan.outputFile).toBe("output.zip");
    expect(plan.contentType).toBe("application/zip");
  });
});

describe("helpers", () => {
  it("supportsAlpha / frameExtFor", () => {
    expect(supportsAlpha("mp4")).toBe(false);
    expect(supportsAlpha("webm")).toBe(true);
    expect(frameExtFor("mp4", false)).toBe("jpg");
    expect(frameExtFor("webm", true)).toBe("png");
    expect(frameExtFor("webm", false)).toBe("jpg");
  });

  it("names frames to match the ffmpeg pattern", () => {
    expect(frameFileName(12, "png")).toBe("f_000012.png");
    expect(frameFileName(0, "jpg")).toBe("f_000000.jpg");
    expect(framePattern("jpg")).toBe("f_%06d.jpg");
  });

  it("computes frame times from the range start", () => {
    expect(frameTime({ range: { start: 0.5, end: 2 }, fps: 10 }, 0)).toBe(0.5);
    expect(frameTime({ range: { start: 0.5, end: 2 }, fps: 10 }, 3)).toBeCloseTo(0.8);
  });

  it("slugifies download names and falls back for non-ASCII", () => {
    expect(slugify("Product Launch!")).toBe("product-launch");
    expect(slugify("  --Hello  World-- ")).toBe("hello-world");
    expect(slugify("ویدیو")).toBe("export");
    expect(slugify("ویدیو v2")).toBe("v2");
    expect(slugify("")).toBe("export");
  });
});

describe("partitionFrames", () => {
  it("splits into contiguous ranges, remainder first", () => {
    expect(partitionFrames(10, 3)).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: 7 },
      { start: 7, end: 10 },
    ]);
  });

  it("never creates empty ranges", () => {
    expect(partitionFrames(2, 5)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
    ]);
    expect(partitionFrames(7, 1)).toEqual([{ start: 0, end: 7 }]);
    expect(partitionFrames(7, 0)).toEqual([{ start: 0, end: 7 }]);
  });

  it("covers every frame exactly once", () => {
    for (const [total, workers] of [
      [1, 3],
      [31, 4],
      [100, 7],
    ]) {
      const ranges = partitionFrames(total, workers);
      expect(ranges[0].start).toBe(0);
      expect(ranges[ranges.length - 1].end).toBe(total);
      for (let i = 1; i < ranges.length; i++) expect(ranges[i].start).toBe(ranges[i - 1].end);
      for (const r of ranges) expect(r.end).toBeGreaterThan(r.start);
    }
  });
});

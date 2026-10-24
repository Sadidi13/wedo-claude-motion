/** Quality-check analysis: per-frame samples → issues a designer can act on. */
import { describe, expect, it } from "vitest";
import { type FrameSample, type QaMeta, type TextSample, buildIssues, formatReport, runs } from "../analyze";
import { sampleTimes } from "../index";

const meta: QaMeta = { width: 1000, height: 1000, duration: 4 };
const { times, step } = sampleTimes(meta.duration);

const text = (over: Partial<TextSample> = {}): TextSample => ({
  key: "title|Hello",
  layerId: "title",
  text: "Hello",
  x: 200,
  y: 200,
  width: 300,
  height: 60,
  fontSize: 48,
  opacity: 1,
  rtlProblem: false,
  clipped: false,
  contrast: 7,
  ...over,
});

/** One sample per time; `texts(i)` gives the texts at sample i. Frames are busy and moving by default. */
function frames(texts: (i: number) => TextSample[], over: (i: number) => Partial<FrameSample> = () => ({})): FrameSample[] {
  return times.map((t, i) => ({ t, texts: texts(i), spread: 40, change: i === 0 ? null : 5, ...over(i) }));
}
const kinds = (list: FrameSample[]) => buildIssues(list, meta, step).map((issue) => `${issue.severity}:${issue.kind}`);

describe("sampleTimes", () => {
  it("takes about two samples a second, centred in their slots, between 6 and 60", () => {
    expect(sampleTimes(4)).toEqual({ times: [0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75], step: 0.5 });
    expect(sampleTimes(1).times).toHaveLength(6);
    expect(sampleTimes(600).times).toHaveLength(60);
  });
});

describe("runs", () => {
  it("groups consecutive matching samples into [start, last + step] ranges", () => {
    const flags = [false, true, true, false, true, false, false, true];
    expect(runs(times, (i) => flags[i], step)).toEqual([
      [0.75, 1.75],
      [2.25, 2.75],
      [3.75, 4.25],
    ]);
  });
});

describe("buildIssues", () => {
  it("finds nothing in a clean, moving scene", () => {
    expect(buildIssues(frames(() => [text()]), meta, step)).toEqual([]);
  });

  it("reports text cut off by the frame when it lasts, and ignores a fly-in", () => {
    const cut = buildIssues(frames((i) => [text(i >= 2 && i <= 5 ? { x: -50 } : {})]), meta, step);
    expect(cut).toEqual([
      { severity: "error", kind: "text-cut", message: "Text “Hello” is cut off at the left edge", layerId: "title", start: 1.25, end: 3.25 },
    ]);
    expect(kinds(frames((i) => [text(i === 0 ? { x: -50 } : {})]))).toEqual([]);
  });

  it("warns about text hugging the edge, and about text clipped by its box", () => {
    expect(kinds(frames(() => [text({ x: 10 })]))).toEqual(["warning:safe-margin"]);
    expect(kinds(frames(() => [text({ clipped: true })]))).toEqual(["warning:text-clipped"]);
  });

  it("grades contrast: under 2:1 is an error, under 3:1 a warning", () => {
    const hard = buildIssues(frames(() => [text({ contrast: 1.4 })]), meta, step);
    expect(hard.map((issue) => issue.severity)).toEqual(["error"]);
    expect(hard[0].message).toContain("contrast 1.4:1");
    expect(kinds(frames(() => [text({ contrast: 2.6 })]))).toEqual(["warning:contrast"]);
    expect(kinds(frames(() => [text({ contrast: undefined })]))).toEqual([]);
  });

  it("flags small text, left-to-right Persian and text shown too briefly", () => {
    expect(buildIssues(frames(() => [text({ fontSize: 12 })]), meta, step)[0].message).toBe(
      "Text “Hello” is small (12px on a 1000x1000 frame); make it at least 20px",
    );
    expect(kinds(frames(() => [text({ text: "سلام", key: "t|سلام", rtlProblem: true })]))).toEqual(["warning:rtl"]);
    const sentence = "Six words are on screen here";
    const brief = buildIssues(frames((i) => (i === 3 ? [text({ text: sentence, key: `t|${sentence}` })] : [])), meta, step);
    expect(brief).toMatchObject([{ kind: "too-brief", start: 1.75, end: 2.25 }]);
    expect(brief[0].message).toContain("give it at least 1.5s");
  });

  it("reports overlapping texts of different layers but not a label inside its own card", () => {
    const other = text({ key: "sub|World", layerId: "sub", text: "World", x: 350, y: 220 });
    expect(kinds(frames(() => [text(), other]))).toEqual(["warning:overlap"]);
    const sameLayer = text({ key: "title|World", text: "World", x: 350, y: 220 });
    expect(kinds(frames(() => [text(), sameLayer]))).toEqual([]);
    const apart = text({ key: "sub|World", layerId: "sub", text: "World", y: 600 });
    expect(kinds(frames(() => [text(), apart]))).toEqual([]);
  });

  it("finds empty and frozen stretches inside the video", () => {
    const empty = buildIssues(frames(() => [], (i) => (i >= 2 && i <= 5 ? { spread: 0.5 } : {})), meta, step);
    expect(empty).toMatchObject([{ kind: "empty", layerId: null, start: 1.25, end: 3.25 }]);
    const frozen = buildIssues(frames(() => [text()], (i) => ({ change: i === 0 ? null : 0.1 })), meta, step);
    expect(frozen).toMatchObject([{ kind: "frozen", start: 0.25, end: 4 }]);
  });

  it("sorts errors first, then by time, and keeps ranges inside the video", () => {
    const list = buildIssues(frames((i) => [text({ x: 10 }), text({ key: "b|Cut", layerId: "b", text: "Cut", y: 700, x: i >= 4 ? 900 : 200 })]), meta, step);
    expect(list.map((issue) => `${issue.severity}:${issue.kind}`)).toEqual(["error:text-cut", "warning:safe-margin"]);
    expect(list.every((issue) => issue.end <= meta.duration)).toBe(true);
  });
});

describe("formatReport", () => {
  it("lists issues with their time range and layer, or says nothing was found", () => {
    expect(formatReport({ duration: 4, frames: 8, issues: [] })).toBe("Quality check: no problems found (8 frames over 4s).");
    const issues = buildIssues(frames(() => [text({ contrast: 1.4 })]), meta, step);
    expect(formatReport({ duration: 4, frames: 8, issues })).toBe(
      "Quality check: 1 problem(s) in 8 frames over 4s.\n" +
        "- [error] 0.25s-4s (layer title): Text “Hello” is hard to read against its background (contrast 1.4:1, aim for 4.5:1)",
    );
  });
});

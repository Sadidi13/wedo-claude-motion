/**
 * Quality-check analysis (docs/QUALITY.md), pure: turns per-frame samples of
 * the rendered scene into issues a designer (or Claude) can act on. The
 * sampling itself happens in headless Chromium (./index.ts).
 *
 * Problems are only reported when they last (a text entering from outside the
 * frame is fine for a few frames), and each issue names the layer and the
 * time range so the editor can jump there.
 */

export type QaSeverity = "error" | "warning";

export type QaKind =
  | "text-cut"
  | "safe-margin"
  | "text-clipped"
  | "overlap"
  | "contrast"
  | "small-text"
  | "rtl"
  | "too-brief"
  | "empty"
  | "frozen";

export interface QaIssue {
  severity: QaSeverity;
  kind: QaKind;
  message: string;
  layerId: string | null;
  start: number;
  end: number;
}

export interface QaReport {
  duration: number;
  frames: number;
  issues: QaIssue[];
}

/** One visible run of text at one sampled time. */
export interface TextSample {
  /** stable across samples: layer id + text */
  key: string;
  layerId: string | null;
  text: string;
  /** stage px */
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  /** effective opacity (own × ancestors) */
  opacity: number;
  /** text contains Persian / Arabic letters but lays out left to right */
  rtlProblem: boolean;
  /** cut by its own box (overflow hidden with content wider or taller than the box) */
  clipped: boolean;
  /** contrast ratio against the background behind it (text hidden), when measured */
  contrast?: number;
}

export interface FrameSample {
  t: number;
  texts: TextSample[];
  /** luminance standard deviation of the frame (0-255): near 0 = one flat colour */
  spread: number;
  /** mean absolute luminance difference to the previous sample (0-255); null for the first */
  change: number | null;
}

export interface QaMeta {
  width: number;
  height: number;
  duration: number;
}

const SHOWN = 0.5;
/** A problem must last at least this long (seconds) to be reported. */
const MIN_PROBLEM_SECONDS = 0.4;
const SAFE_MARGIN = 0.035;
const EMPTY_SPREAD = 2;
const FROZEN_CHANGE = 0.35;
const FROZEN_SECONDS = 3;

function label(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return `“${flat.length > 32 ? `${flat.slice(0, 31)}…` : flat}”`;
}

function fmt(t: number): string {
  return `${Number(t.toFixed(2))}s`;
}

/** Consecutive sample times where `test` holds, as [start, end] ranges (end = last time + step). */
export function runs(times: number[], test: (index: number) => boolean, step: number): [number, number][] {
  const out: [number, number][] = [];
  let open: number | null = null;
  times.forEach((t, i) => {
    if (test(i)) {
      if (open === null) open = t;
    } else if (open !== null) {
      out.push([open, times[i - 1] + step]);
      open = null;
    }
  });
  if (open !== null) out.push([open, times[times.length - 1] + step]);
  return out;
}

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Issues from the samples of a whole render; `step` is the time between samples. */
export function buildIssues(frames: FrameSample[], meta: QaMeta, step: number): QaIssue[] {
  const issues: QaIssue[] = [];
  const times = frames.map((frame) => frame.t);
  const longEnough = ([start, end]: [number, number]) => end - start >= Math.max(MIN_PROBLEM_SECONDS, step * 1.5);

  // Every text seen, by key, with its sample per frame index.
  const byKey = new Map<string, (TextSample | undefined)[]>();
  frames.forEach((frame, index) => {
    for (const sample of frame.texts) {
      if (!byKey.has(sample.key)) byKey.set(sample.key, new Array(frames.length).fill(undefined));
      byKey.get(sample.key)![index] = sample;
    }
  });

  const marginX = meta.width * SAFE_MARGIN;
  const marginY = meta.height * SAFE_MARGIN;
  const minFont = Math.min(meta.width, meta.height) * 0.02;

  for (const samples of byKey.values()) {
    const first = samples.find(Boolean)!;
    const name = label(first.text);
    const shown = (i: number) => (samples[i]?.opacity ?? 0) >= SHOWN;
    const at = (i: number) => samples[i]!;

    const cut = (i: number) =>
      shown(i) && (at(i).x < -2 || at(i).y < -2 || at(i).x + at(i).width > meta.width + 2 || at(i).y + at(i).height > meta.height + 2);
    for (const range of runs(times, cut, step).filter(longEnough)) {
      const i = times.indexOf(range[0]);
      const s = at(i);
      const edge = s.x < -2 ? "left" : s.x + s.width > meta.width + 2 ? "right" : s.y < -2 ? "top" : "bottom";
      issues.push({ severity: "error", kind: "text-cut", message: `Text ${name} is cut off at the ${edge} edge`, layerId: s.layerId, start: range[0], end: range[1] });
    }

    const tight = (i: number) =>
      shown(i) &&
      !cut(i) &&
      (at(i).x < marginX || at(i).y < marginY || at(i).x + at(i).width > meta.width - marginX || at(i).y + at(i).height > meta.height - marginY);
    for (const range of runs(times, tight, step).filter((r) => r[1] - r[0] >= 1)) {
      issues.push({ severity: "warning", kind: "safe-margin", message: `Text ${name} sits very close to the edge of the frame`, layerId: first.layerId, start: range[0], end: range[1] });
    }

    for (const range of runs(times, (i) => shown(i) && at(i).clipped, step).filter(longEnough)) {
      issues.push({ severity: "warning", kind: "text-clipped", message: `Text ${name} does not fit its box and is clipped`, layerId: first.layerId, start: range[0], end: range[1] });
    }

    const lowContrast = (limit: number) => (i: number) => shown(i) && at(i).contrast !== undefined && at(i).contrast! < limit;
    const hard = runs(times, lowContrast(2), step).filter(longEnough);
    const weak = runs(times, lowContrast(3), step).filter(longEnough);
    for (const range of hard.length ? hard : weak) {
      const values = samples.slice(times.indexOf(range[0])).filter((s) => s?.contrast !== undefined).map((s) => s!.contrast!);
      const worst = Math.min(...values);
      issues.push({
        severity: hard.length ? "error" : "warning",
        kind: "contrast",
        message: `Text ${name} is hard to read against its background (contrast ${worst.toFixed(1)}:1, aim for 4.5:1)`,
        layerId: first.layerId,
        start: range[0],
        end: range[1],
      });
    }

    const sizes = samples.filter((s) => s && s.opacity >= SHOWN).map((s) => s!.fontSize);
    if (sizes.length && Math.max(...sizes) < minFont) {
      const firstShown = times[samples.findIndex((s) => s && s.opacity >= SHOWN)];
      issues.push({
        severity: "warning",
        kind: "small-text",
        message: `Text ${name} is small (${Math.round(Math.max(...sizes))}px on a ${meta.width}x${meta.height} frame); make it at least ${Math.ceil(minFont)}px`,
        layerId: first.layerId,
        start: firstShown,
        end: firstShown + step,
      });
    }

    const rtl = samples.findIndex((s) => s && s.opacity >= SHOWN && s.rtlProblem);
    if (rtl >= 0) {
      issues.push({ severity: "warning", kind: "rtl", message: `Persian text ${name} is laid out left to right; set direction: "rtl"`, layerId: first.layerId, start: times[rtl], end: times[rtl] + step });
    }

    const visible = samples.filter((s) => s && s.opacity >= SHOWN).length * step;
    const needed = Math.max(0.8, words(first.text) * 0.25);
    if (visible > 0 && visible < needed && words(first.text) >= 3) {
      const start = times[samples.findIndex((s) => s && s.opacity >= SHOWN)];
      issues.push({
        severity: "warning",
        kind: "too-brief",
        message: `Text ${name} is readable for only about ${visible.toFixed(1)}s; give it at least ${needed.toFixed(1)}s`,
        layerId: first.layerId,
        start,
        end: start + visible,
      });
    }
  }

  // Overlapping texts (different layers, both shown).
  const keys = [...byKey.keys()];
  for (let a = 0; a < keys.length; a++) {
    for (let b = a + 1; b < keys.length; b++) {
      const sa = byKey.get(keys[a])!;
      const sb = byKey.get(keys[b])!;
      if (sa.find(Boolean)?.layerId && sa.find(Boolean)?.layerId === sb.find(Boolean)?.layerId) continue;
      const overlaps = (i: number) => {
        const p = sa[i];
        const q = sb[i];
        if (!p || !q || p.opacity < SHOWN || q.opacity < SHOWN) return false;
        const w = Math.min(p.x + p.width, q.x + q.width) - Math.max(p.x, q.x);
        const h = Math.min(p.y + p.height, q.y + q.height) - Math.max(p.y, q.y);
        if (w <= 0 || h <= 0) return false;
        // Contained text (a label inside its own card) is fine; partial overlap of two texts is not.
        const smaller = Math.min(p.width * p.height, q.width * q.height);
        return (w * h) / smaller > 0.2;
      };
      for (const range of runs(times, overlaps, step).filter(longEnough)) {
        const p = sa.find(Boolean)!;
        const q = sb.find(Boolean)!;
        issues.push({ severity: "warning", kind: "overlap", message: `Texts ${label(p.text)} and ${label(q.text)} overlap`, layerId: p.layerId, start: range[0], end: range[1] });
      }
    }
  }

  // Empty and frozen stretches (inside the video, not its first / last half second).
  const inner = (i: number) => times[i] > 0.5 && times[i] < meta.duration - 0.5;
  for (const range of runs(times, (i) => inner(i) && frames[i].spread < EMPTY_SPREAD, step).filter((r) => r[1] - r[0] >= 1)) {
    issues.push({ severity: "warning", kind: "empty", message: `Nothing is visible from ${fmt(range[0])} to ${fmt(range[1])}`, layerId: null, start: range[0], end: range[1] });
  }
  for (const range of runs(times, (i) => frames[i].change !== null && frames[i].change! < FROZEN_CHANGE, step)) {
    const start = range[0] - step;
    if (range[1] - start >= FROZEN_SECONDS) {
      issues.push({
        severity: "warning",
        kind: "frozen",
        message: `Nothing moves from ${fmt(Math.max(0, start))} to ${fmt(range[1])}; a slow drift or a hold of under ${FROZEN_SECONDS}s keeps it alive`,
        layerId: null,
        start: Math.max(0, start),
        end: range[1],
      });
    }
  }

  const rank = { error: 0, warning: 1 } as const;
  return issues
    .map((issue) => ({ ...issue, start: Math.max(0, issue.start), end: Math.min(meta.duration, issue.end) }))
    .sort((a, b) => rank[a.severity] - rank[b.severity] || a.start - b.start);
}

/** The report as plain text (for Claude's tools and the CLI). */
export function formatReport(report: QaReport): string {
  if (report.issues.length === 0) return `Quality check: no problems found (${report.frames} frames over ${report.duration}s).`;
  const lines = [`Quality check: ${report.issues.length} problem(s) in ${report.frames} frames over ${report.duration}s.`];
  for (const issue of report.issues) {
    lines.push(`- [${issue.severity}] ${fmt(issue.start)}-${fmt(issue.end)}${issue.layerId ? ` (layer ${issue.layerId})` : ""}: ${issue.message}`);
  }
  return lines.join("\n");
}

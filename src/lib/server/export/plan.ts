/**
 * Pure export planning (CONTRACTS.md §6): turns a project + ExportOptions into
 * the concrete numbers every other export file agrees on — fps, scale, the
 * clamped time range, frame count, frame file naming, output file name and
 * MIME type — plus the frame partitioning used by the parallel renderer.
 * No I/O here so all of it is unit-testable.
 */

import type { ExportFormat, ExportOptions, Project } from "@/lib/types";

export type FrameExt = "png" | "jpg";

export interface RenderPlan {
  format: ExportFormat;
  fps: number;
  scale: 1 | 2;
  /** seconds, clamped to [0, duration] */
  range: { start: number; end: number };
  /** alpha requested AND the format can carry it */
  transparent: boolean;
  /** H.264 CRF (mp4 only) */
  quality: number;
  /** stage size in CSS px = Playwright viewport */
  width: number;
  height: number;
  /** pixel size of the rendered frames and of the encoded output (= stage × scale) */
  outputWidth: number;
  outputHeight: number;
  frameCount: number;
  frameExt: FrameExt;
  /** file name inside the job dir, e.g. "output.mp4" */
  outputFile: string;
  /** user-facing download name, e.g. "product-launch.mp4" */
  fileName: string;
  contentType: string;
}

export const DEFAULT_CRF = 17;

const OUTPUT_BY_FORMAT: Record<ExportFormat, { ext: string; contentType: string }> = {
  mp4: { ext: "mp4", contentType: "video/mp4" },
  webm: { ext: "webm", contentType: "video/webm" },
  mov: { ext: "mov", contentType: "video/quicktime" },
  gif: { ext: "gif", contentType: "image/gif" },
  "png-sequence": { ext: "zip", contentType: "application/zip" },
};

const ALPHA_FORMATS: ReadonlySet<ExportFormat> = new Set(["webm", "mov", "png-sequence"]);

/** Formats that can carry an alpha channel (mp4 + gif are always opaque). */
export function supportsAlpha(format: ExportFormat): boolean {
  return ALPHA_FORMATS.has(format);
}

/** PNG frames whenever alpha is kept or the deliverable *is* the PNGs; JPEG (q95) otherwise. */
export function frameExtFor(format: ExportFormat, transparent: boolean): FrameExt {
  return transparent || format === "png-sequence" ? "png" : "jpg";
}

/** `f_000012.png` — matches ffmpeg's `f_%06d.<ext>` input pattern. */
export function frameFileName(index: number, ext: FrameExt): string {
  return `f_${String(index).padStart(6, "0")}.${ext}`;
}

/** ffmpeg image2 input pattern for the frames of a plan. */
export function framePattern(ext: FrameExt): string {
  return `f_%06d.${ext}`;
}

/** Stage time of frame `index` (0-based within the export range). */
export function frameTime(plan: Pick<RenderPlan, "range" | "fps">, index: number): number {
  return plan.range.start + index / plan.fps;
}

/** Lower-case ASCII slug for download file names; falls back to "export" (Persian names etc.). */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "export";
}

export function resolvePlan(project: Project, options: ExportOptions): RenderPlan {
  const { meta } = project;
  const fps = options.fps ?? meta.fps;
  const scale = options.scale ?? 1;
  const requested = options.range ?? { start: 0, end: meta.duration };
  const range = {
    start: Math.min(Math.max(requested.start, 0), meta.duration),
    end: Math.min(Math.max(requested.end, 0), meta.duration),
  };
  if (range.end <= range.start) throw new Error("Export range is empty after clamping to the stage duration");
  const frameCount = Math.round((range.end - range.start) * fps);
  if (frameCount < 1) throw new Error("Export range is shorter than one frame");

  const transparent = Boolean(options.transparent) && supportsAlpha(options.format);
  const out = OUTPUT_BY_FORMAT[options.format];
  return {
    format: options.format,
    fps,
    scale,
    range,
    transparent,
    quality: options.quality ?? DEFAULT_CRF,
    width: meta.width,
    height: meta.height,
    outputWidth: meta.width * scale,
    outputHeight: meta.height * scale,
    frameCount,
    frameExt: frameExtFor(options.format, transparent),
    outputFile: `output.${out.ext}`,
    fileName: `${slugify(project.name)}.${out.ext}`,
    contentType: out.contentType,
  };
}

export interface FrameRange {
  /** first frame index (inclusive) */
  start: number;
  /** last frame index (exclusive) */
  end: number;
}

/**
 * Splits `total` frames into at most `workers` contiguous, non-empty ranges
 * (the first ranges get the remainder). Never returns an empty range.
 */
export function partitionFrames(total: number, workers: number): FrameRange[] {
  const count = Math.max(1, Math.min(Math.floor(workers), total));
  const base = Math.floor(total / count);
  const remainder = total % count;
  const ranges: FrameRange[] = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const size = base + (i < remainder ? 1 : 0);
    ranges.push({ start: cursor, end: cursor + size });
    cursor += size;
  }
  return ranges;
}

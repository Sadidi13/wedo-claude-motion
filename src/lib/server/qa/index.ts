/**
 * Automatic quality check (docs/QUALITY.md): renders the scene in headless
 * Chromium exactly like an export (same page, same sandbox and network rules),
 * samples about two frames per second, and measures what a designer would
 * notice: text cut off or crowding the edge, clipped or overlapping text, low
 * contrast against the background, tiny or left-to-right Persian text, text on
 * screen too briefly, empty or frozen stretches. Runs locally; it costs no
 * Claude usage, and Claude gets the findings as text. For the autopilot's
 * visual review after a build it also saves contact sheets of the frames.
 */

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import type { Project } from "@/lib/types";
import { createJob, jobDir } from "../export/jobs";
import {
  chromiumLaunchArgs,
  chromiumSandboxEnabled,
  isAllowedRenderRequest,
  previewUrl,
  projectMediaIds,
  projectUsesWebGL,
  resolveChromiumPath,
  warmMediaRoutes,
} from "../export/renderer";
import { ExportRequestError } from "../export/schema";
import { ensureMediaReady } from "../media/ingest";
import { type FrameSample, type QaReport, type QaReview, type TextSample, buildIssues } from "./analyze";

export { formatReport, type QaIssue, type QaReport, type QaReview } from "./analyze";

/** Screenshots are taken at this fraction of the stage size: plenty for luminance, quick to grab. */
const SAMPLE_SCALE = 0.5;
const MIN_SAMPLES = 6;
const MAX_SAMPLES = 60;
const READY_TIMEOUT_MS = 60_000;

let running = false;

/** A review shows this many frames, six to a sheet. */
const REVIEW_FRAMES = 12;
const REVIEW_PER_SHEET = 6;
/** Longest side of a sheet: the size Claude looks at an image without shrinking it. */
const REVIEW_SHEET_MAX = 1568;

export interface ReviewLayout {
  /** indexes of the samples shown, evenly spread, first and last included */
  picks: number[];
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
}

/** Which samples a review shows and how a sheet lays them out for the stage's shape. */
export function reviewLayout(width: number, height: number, samples: number): ReviewLayout {
  const count = Math.min(REVIEW_FRAMES, samples);
  const picks = count <= 1 ? [0] : Array.from({ length: count }, (_, i) => Math.round((i * (samples - 1)) / (count - 1)));
  const columns = width >= height * 1.2 ? 2 : 3;
  const rows = REVIEW_PER_SHEET / columns;
  const scale = Math.min(REVIEW_SHEET_MAX / (columns * width), REVIEW_SHEET_MAX / (rows * height));
  return { picks, columns, rows, tileWidth: Math.round(width * scale), tileHeight: Math.round(height * scale) };
}

interface SheetInput {
  frames: string[];
  labels: string[];
  columns: number;
  tileWidth: number;
  tileHeight: number;
}

/** Runs in the page: the frames tiled into one JPEG (base64), each with its time in the corner. */
async function composeSheet(input: SheetInput): Promise<string> {
  const rows = Math.ceil(input.frames.length / input.columns);
  const canvas = document.createElement("canvas");
  canvas.width = input.columns * input.tileWidth;
  canvas.height = rows * input.tileHeight;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = "600 18px system-ui, sans-serif";
  context.textBaseline = "middle";
  for (const [i, data] of input.frames.entries()) {
    const image = new Image();
    image.src = `data:image/jpeg;base64,${data}`;
    await image.decode();
    const x = (i % input.columns) * input.tileWidth;
    const y = Math.floor(i / input.columns) * input.tileHeight;
    context.drawImage(image, x, y, input.tileWidth, input.tileHeight);
    context.strokeStyle = "#000";
    context.lineWidth = 2;
    context.strokeRect(x + 1, y + 1, input.tileWidth - 2, input.tileHeight - 2);
    const label = input.labels[i];
    const width = context.measureText(label).width + 14;
    context.fillStyle = "rgba(0, 0, 0, 0.72)";
    context.fillRect(x + 6, y + 6, width, 26);
    context.fillStyle = "#fff";
    context.fillText(label, x + 13, y + 19);
  }
  return canvas.toDataURL("image/jpeg", 0.86).slice("data:image/jpeg;base64,".length);
}

/** Where a review's sheets go: `<dir>/<name>-1.jpg`, … (earlier sheets in the folder are removed). */
export interface ReviewTarget {
  dir: string;
  name: string;
}

async function writeReviewSheets(page: Page, layout: ReviewLayout, frames: { data: string; t: number }[], target: ReviewTarget): Promise<QaReview> {
  await mkdir(target.dir, { recursive: true });
  for (const name of await readdir(target.dir)) {
    if (name.endsWith(".jpg")) await rm(path.join(target.dir, name), { force: true });
  }
  const sheets: QaReview["sheets"] = [];
  for (let first = 0; first < frames.length; first += REVIEW_PER_SHEET) {
    const chunk = frames.slice(first, first + REVIEW_PER_SHEET);
    const jpeg = await page.evaluate(composeSheet, {
      frames: chunk.map((frame) => frame.data),
      labels: chunk.map((frame) => `${Number(frame.t.toFixed(2))} s`),
      columns: layout.columns,
      tileWidth: layout.tileWidth,
      tileHeight: layout.tileHeight,
    });
    const file = path.join(target.dir, `${target.name}-${sheets.length + 1}.jpg`);
    await writeFile(file, Buffer.from(jpeg, "base64"));
    sheets.push({ file, times: chunk.map((frame) => frame.t) });
  }
  return { columns: layout.columns, rows: layout.rows, sheets };
}

/** Sample times: about two per second, centred in their slots, capped for long videos. */
export function sampleTimes(duration: number): { times: number[]; step: number } {
  const count = Math.min(MAX_SAMPLES, Math.max(MIN_SAMPLES, Math.round(duration * 2)));
  const step = duration / count;
  return { times: Array.from({ length: count }, (_, i) => Number(((i + 0.5) * step).toFixed(4))), step };
}

interface PageText extends Omit<TextSample, "contrast"> {
  color: string;
}

/** Runs in the page: every visible run of text in the stage, with its glyph box and styles. */
function collectTexts(): PageText[] {
  const stage = document.querySelector<HTMLElement>("[data-stage]");
  if (!stage) return [];
  const origin = stage.getBoundingClientRect();
  const arabic = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
  const out: PageText[] = [];
  const seen = new Set<string>();
  const walker = document.createTreeWalker(stage, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode() as HTMLElement | null; node; node = walker.nextNode() as HTMLElement | null) {
    const textNodes = [...node.childNodes].filter((child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim());
    if (textNodes.length === 0) continue;
    const text = textNodes.map((child) => child.textContent ?? "").join(" ").replace(/\s+/g, " ").trim();
    let opacity = 1;
    for (let el: HTMLElement | null = node; el && el !== stage; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") {
        opacity = 0;
        break;
      }
      opacity *= Number(style.opacity);
    }
    if (opacity < 0.05) continue;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const child of textNodes) {
      const range = document.createRange();
      range.selectNodeContents(child);
      for (const rect of range.getClientRects()) {
        if (rect.width < 0.5 || rect.height < 0.5) continue;
        left = Math.min(left, rect.left);
        top = Math.min(top, rect.top);
        right = Math.max(right, rect.right);
        bottom = Math.max(bottom, rect.bottom);
      }
    }
    if (!Number.isFinite(left)) continue;
    const layerId = node.closest("[data-layer-id]")?.getAttribute("data-layer-id") ?? null;
    const key = `${layerId ?? ""}|${text.slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const style = getComputedStyle(node);
    const clips = [style.overflowX, style.overflowY].some((value) => value === "hidden" || value === "clip");
    out.push({
      key,
      layerId,
      text: text.slice(0, 80),
      x: left - origin.left,
      y: top - origin.top,
      width: right - left,
      height: bottom - top,
      fontSize: parseFloat(style.fontSize) || 0,
      opacity,
      rtlProblem: arabic.test(text) && style.direction !== "rtl",
      clipped: clips && (node.scrollWidth > node.clientWidth + 2 || node.scrollHeight > node.clientHeight + 2),
      color: node instanceof SVGElement ? style.fill : style.color,
    });
  }
  return out;
}

interface PixelInput {
  normal: string;
  hidden: string | null;
  boxes: { x: number; y: number; width: number; height: number; color: string }[];
  scale: number;
}

interface PixelResult {
  spread: number;
  small: number[];
  contrasts: (number | null)[];
}

/** Runs in the page: luminance statistics of the screenshots (decoded with the browser's own image decoder). */
async function analysePixels(input: PixelInput): Promise<PixelResult> {
  const load = async (data: string) => {
    const image = new Image();
    image.src = `data:image/jpeg;base64,${data}`;
    await image.decode();
    return image;
  };
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const relative = (r: number, g: number, b: number) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

  const frame = await load(input.normal);
  const canvas = document.createElement("canvas");
  canvas.width = frame.naturalWidth;
  canvas.height = frame.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(frame, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let sum = 0;
  let squares = 0;
  let count = 0;
  for (let i = 0; i < pixels.length; i += 16) {
    const luma = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
    sum += luma;
    squares += luma * luma;
    count++;
  }
  const mean = sum / count;
  const spread = Math.sqrt(Math.max(0, squares / count - mean * mean));

  const small = document.createElement("canvas");
  small.width = 32;
  small.height = 18;
  const smallContext = small.getContext("2d", { willReadFrequently: true })!;
  smallContext.drawImage(frame, 0, 0, 32, 18);
  const tiny = smallContext.getImageData(0, 0, 32, 18).data;
  const thumb: number[] = [];
  for (let i = 0; i < tiny.length; i += 4) thumb.push(0.2126 * tiny[i] + 0.7152 * tiny[i + 1] + 0.0722 * tiny[i + 2]);

  const contrasts: (number | null)[] = [];
  if (input.hidden) {
    const background = await load(input.hidden);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(background, 0, 0);
    for (const box of input.boxes) {
      const match = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(box.color);
      const x = Math.max(0, Math.floor(box.x * input.scale));
      const y = Math.max(0, Math.floor(box.y * input.scale));
      const w = Math.min(canvas.width - x, Math.ceil(box.width * input.scale));
      const h = Math.min(canvas.height - y, Math.ceil(box.height * input.scale));
      if (!match || w < 1 || h < 1) {
        contrasts.push(null);
        continue;
      }
      const text = relative(Number(match[1]), Number(match[2]), Number(match[3]));
      const data = context.getImageData(x, y, w, h).data;
      const values: number[] = [];
      for (let i = 0; i < data.length; i += 4) values.push(relative(data[i], data[i + 1], data[i + 2]));
      values.sort((a, b) => a - b);
      const low = values[Math.floor(values.length * 0.25)];
      const high = values[Math.floor(values.length * 0.75)];
      // The quartile closer to the text's own luminance is the harder case.
      contrasts.push(Math.min(ratio(text, low), ratio(text, high)));
    }
  }
  return { spread, small: thumb, contrasts };
}

// SVG text paints with fill and stroke, not color: hidden too, or its contrast is measured against itself.
const HIDE_TEXT_CSS =
  "[data-stage] * { color: transparent !important; text-shadow: none !important; -webkit-text-stroke-color: transparent !important; caret-color: transparent !important; }" +
  " [data-stage] svg text, [data-stage] svg tspan { fill: transparent !important; stroke: transparent !important; }";

/**
 * Render the project headlessly and report what a designer should fix. One check at a time. With
 * `review`, contact sheets of the frames are saved there for a visual review.
 */
export async function runQualityCheck(project: Project, origin: string, options: { review?: ReviewTarget } = {}): Promise<QaReport> {
  if (running) throw new ExportRequestError("A quality check is already running. Try again when it is done.", 429);
  running = true;
  let jobId: string | null = null;
  try {
    ({ jobId } = await createJob({ project, options: { format: "png-sequence" } }));
    const meta = project.meta;
    const { times, step } = sampleTimes(meta.duration);
    const url = previewUrl(origin, jobId, false);
    // Library videos are checked as they will export: their frames must exist and may load.
    const mediaIds = projectMediaIds(project);
    await ensureMediaReady(mediaIds);
    await warmMediaRoutes(origin, mediaIds);
    const browser = await chromium.launch({
      executablePath: resolveChromiumPath(),
      args: chromiumLaunchArgs(projectUsesWebGL(project)),
      chromiumSandbox: chromiumSandboxEnabled(),
    });
    try {
      const context = await browser.newContext({ viewport: { width: meta.width, height: meta.height }, deviceScaleFactor: SAMPLE_SCALE });
      const id = jobId;
      await context.route("**/*", (route) =>
        isAllowedRenderRequest(route.request().url(), url, id, mediaIds) ? route.continue() : route.abort("blockedbyclient"),
      );
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "load", timeout: READY_TIMEOUT_MS });
      await page.waitForFunction(() => {
        const w = window as unknown as { __ready?: boolean; __seek?: unknown };
        return w.__ready === true && typeof w.__seek === "function";
      }, undefined, { timeout: READY_TIMEOUT_MS });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const clip = { x: 0, y: 0, width: meta.width, height: meta.height };
      const frames: FrameSample[] = [];
      const layout = options.review ? reviewLayout(meta.width, meta.height, times.length) : null;
      const kept = new Map<number, string>();
      let previous: number[] | null = null;
      for (const [index, t] of times.entries()) {
        await page.evaluate(
          (time) =>
            new Promise<void>((resolve, reject) => {
              const w = window as unknown as { __seek?: (t: number) => void; __whenIdle?: () => Promise<void> };
              w.__seek?.(time);
              const idle = typeof w.__whenIdle === "function" ? w.__whenIdle() : Promise.resolve();
              const timer = setTimeout(() => reject(new Error(`seek ${time} timed out`)), 15_000);
              idle.then(() => requestAnimationFrame(() => requestAnimationFrame(() => (clearTimeout(timer), resolve()))), reject);
            }),
          t,
        );
        const texts = await page.evaluate(collectTexts);
        const normal = (await page.screenshot({ type: "jpeg", quality: layout ? 85 : 70, clip })).toString("base64");
        if (layout?.picks.includes(index)) kept.set(index, normal);
        let hidden: string | null = null;
        if (texts.length) {
          const handle = await page.addStyleTag({ content: HIDE_TEXT_CSS });
          hidden = (await page.screenshot({ type: "jpeg", quality: 70, clip })).toString("base64");
          await handle.evaluate((element) => (element as Element).remove());
        }
        const pixels = await page.evaluate(analysePixels, {
          normal,
          hidden,
          boxes: texts.map(({ x, y, width, height, color }) => ({ x, y, width, height, color })),
          scale: SAMPLE_SCALE,
        });
        const change = previous ? previous.reduce((total, value, i) => total + Math.abs(value - pixels.small[i]), 0) / previous.length : null;
        previous = pixels.small;
        frames.push({
          t,
          spread: pixels.spread,
          change,
          texts: texts.map(({ color: _color, ...text }, i) => {
            void _color;
            const contrast = pixels.contrasts[i];
            return contrast === null || contrast === undefined ? text : { ...text, contrast };
          }),
        });
      }
      const report: QaReport = { duration: meta.duration, frames: frames.length, issues: buildIssues(frames, meta, step) };
      if (layout && options.review) {
        const shown = layout.picks.map((i) => ({ data: kept.get(i) ?? "", t: times[i] })).filter((frame) => frame.data);
        report.review = await writeReviewSheets(page, layout, shown, options.review);
      }
      return report;
    } finally {
      await browser.close();
    }
  } finally {
    running = false;
    if (jobId) await rm(jobDir(jobId), { recursive: true, force: true }).catch(() => undefined);
  }
}

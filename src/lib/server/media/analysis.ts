/**
 * A reference video seen in full (docs/STORYBOARD.md, "References"), measured on this computer
 * with ffmpeg so it costs no Claude usage. For one library file it writes `analysis/` next to it:
 *
 *   sheet-01.jpg …   dense contact sheets of the whole video (up to 8 frames per second, at most
 *                    MAX_SHEETS sheets, tiles shaped like the video), left to right, top to bottom
 *   strip-01.jpg …   every frame around up to MAX_STRIPS cuts, for how the transitions move
 *   analysis.json    ReferenceAnalysis: cut times, each shot's main colours and brightness,
 *                    loudness, and the time of every tile
 *
 * Claude reads the sheets, strips and numbers (as images and text in the style step's brief) and
 * writes the style spec the style frames, the storyboard and the build follow. An image reference
 * gets one downscaled copy and its colours.
 */

import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { mediaKindOf, type MediaMeta } from "@/lib/media";
import { ffmpegPath, runFfmpeg } from "../export/ffmpeg";
import { readJsonFile, writeJsonFile } from "../jsonFile";
import { mediaDir, mediaPaths, readMeta, updateMeta } from "./store";

export const MAX_SHEETS = 12;
export const MAX_STRIPS = 6;
const MAX_SHEET_FPS = 8;
/** Long side of one contact-sheet tile, in pixels. */
const TILE_SIDE = 300;
/** Scene-change score that counts as a cut (ffmpeg's select filter, 0..1). */
const CUT_THRESHOLD = 0.3;
const MAX_CUTS = 80;
const MAX_SHOTS = 40;
/** A strip covers this long around a cut, at the video's frame rate (at most 30 fps). */
const STRIP_BEFORE = 0.25;
const STRIP_LENGTH = 0.6;

export interface ShotInfo {
  start: number;
  end: number;
  /** main colours, most common first (#rrggbb) */
  colors: string[];
  /** mean luminance 0..1 */
  brightness: number;
}

export interface ReferenceAnalysis {
  version: 1;
  kind: "video" | "image";
  duration: number;
  width: number;
  height: number;
  fps: number;
  /** seconds where a new shot starts */
  cuts: number[];
  shots: ShotInfo[];
  sheets: { file: string; columns: number; rows: number; times: number[] }[];
  strips: { file: string; cut: number; times: number[] }[];
  /** EBU R128 integrated loudness (LUFS) and true peak (dBFS); null without sound */
  loudness: { integrated: number; peak: number } | null;
  createdAt: string;
}

export const analysisDir = (id: string) => path.join(mediaDir(id), "analysis");
export const analysisFile = (id: string) => path.join(analysisDir(id), "analysis.json");

/** Image names the analysis writes (the only ones the routes serve). */
export const ANALYSIS_IMAGE = /^(?:sheet|strip)-\d{2}\.jpg$/;

// ---------------------------------------------------------------------------
// Pure helpers (tested)
// ---------------------------------------------------------------------------

/** Cut times from `select='gt(scene,x)',showinfo` output on stderr. */
export function parseCuts(stderr: string): number[] {
  const cuts: number[] = [];
  for (const match of stderr.matchAll(/pts_time:\s*(\d+(?:\.\d+)?)/g)) {
    const t = Number(match[1]);
    if (t > 0.05 && (cuts.length === 0 || t - cuts[cuts.length - 1] > 0.08)) cuts.push(Number(t.toFixed(3)));
  }
  return cuts.slice(0, MAX_CUTS);
}

/** Integrated loudness and true peak from ffmpeg's `ebur128=peak=true` summary. */
export function parseLoudness(stderr: string): { integrated: number; peak: number } | null {
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const integrated = /I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/.exec(summary);
  const peak = /Peak:\s+(-?(?:\d+(?:\.\d+)?|inf))\s+dBFS/.exec(summary);
  if (!integrated) return null;
  const peakValue = peak ? Number(peak[1]) : NaN;
  return { integrated: Number(integrated[1]), peak: Number.isFinite(peakValue) ? peakValue : -70 };
}

/** The shots between cuts, shorter than a tenth of a second dropped. */
export function shotsBetween(cuts: number[], duration: number): { start: number; end: number }[] {
  const edges = [0, ...cuts.filter((t) => t < duration), duration];
  const shots: { start: number; end: number }[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    if (edges[i + 1] - edges[i] >= 0.1) shots.push({ start: Number(edges[i].toFixed(3)), end: Number(edges[i + 1].toFixed(3)) });
  }
  return shots;
}

/** Up to `max` cuts spread over the video (all of them when there are few). */
export function pickStripCuts(cuts: number[], max = MAX_STRIPS): number[] {
  if (cuts.length <= max) return cuts;
  return Array.from({ length: max }, (_, i) => cuts[Math.round((i * (cuts.length - 1)) / (max - 1))]);
}

/** Contact-sheet layout: tiles shaped like the video, about square sheets, at most MAX_SHEETS of them. */
export function sheetPlan(duration: number, width: number, height: number) {
  const portrait = height > width;
  const tileWidth = 2 * Math.round((portrait ? (TILE_SIDE * width) / height : TILE_SIDE) / 2);
  const tileHeight = 2 * Math.round((portrait ? TILE_SIDE : (TILE_SIDE * height) / width) / 2);
  const ratio = width / height;
  const columns = ratio < 0.8 ? 6 : ratio > 1.25 ? 3 : 4;
  const rows = ratio < 0.8 ? 3 : ratio > 1.25 ? 6 : 4;
  const tiles = columns * rows;
  const fps = Math.min(MAX_SHEET_FPS, (MAX_SHEETS * tiles) / Math.max(duration, 0.1));
  const frames = Math.max(1, Math.floor(duration * fps));
  return { tileWidth, tileHeight, columns, rows, fps: Number(fps.toFixed(4)), sheets: Math.ceil(frames / tiles), frames };
}

/** Main colours and brightness of a small RGB24 image (16x16 is plenty). */
export function dominantColors(rgb: Uint8Array, count = 4): { colors: string[]; brightness: number } {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  let luma = 0;
  const pixels = Math.floor(rgb.length / 3);
  for (let i = 0; i < pixels; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  const colors = [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map((bucket) => `#${hex(bucket.r / bucket.n)}${hex(bucket.g / bucket.n)}${hex(bucket.b / bucket.n)}`);
  return { colors, brightness: pixels ? Number((luma / pixels / 255).toFixed(3)) : 0 };
}

// ---------------------------------------------------------------------------
// ffmpeg passes
// ---------------------------------------------------------------------------

/** Run ffmpeg and keep all of stderr (cut detection prints one line per cut) and stdout as bytes. */
function ffmpegOutput(args: string[], timeoutMs: number): Promise<{ stderr: string; stdout: Buffer }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const out: Buffer[] = [];
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`ffmpeg timed out after ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 4_000_000) stderr = stderr.slice(-2_000_000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stderr, stdout: Buffer.concat(out) });
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim().split(/\r?\n/).slice(-2).join(" ")}`));
    });
  });
}

const QUIET = ["-hide_banner", "-nostats", "-y"];

async function frameColors(source: string, time: number): Promise<{ colors: string[]; brightness: number }> {
  const { stdout } = await ffmpegOutput(
    [...QUIET, "-loglevel", "error", "-ss", String(time), "-i", source, "-frames:v", "1", "-vf", "scale=16:16:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
    60_000,
  );
  return dominantColors(new Uint8Array(stdout));
}

async function analyzeVideo(meta: MediaMeta, dir: string): Promise<ReferenceAnalysis> {
  const source = mediaPaths.source(meta.id, meta.ext);
  const duration = meta.duration;
  const timeout = Math.max(5 * 60_000, duration * 20_000);

  const detection = await ffmpegOutput(
    [...QUIET, "-i", source, "-an", "-vf", `scale=320:-2,select='gt(scene,${CUT_THRESHOLD})',showinfo`, "-f", "null", "-"],
    timeout,
  );
  const cuts = parseCuts(detection.stderr);

  const plan = sheetPlan(duration, meta.width, meta.height);
  await runFfmpeg(
    [
      ...QUIET, "-loglevel", "error", "-i", source, "-an",
      "-vf", `fps=${plan.fps},scale=${plan.tileWidth}:${plan.tileHeight},tile=${plan.columns}x${plan.rows}:padding=4:color=black`,
      "-q:v", "3", path.join(dir, "sheet-%02d.jpg"),
    ],
    { timeoutMs: timeout },
  );
  const tiles = plan.columns * plan.rows;
  const sheets = Array.from({ length: Math.min(plan.sheets, MAX_SHEETS) }, (_, s) => ({
    file: `sheet-${String(s + 1).padStart(2, "0")}.jpg`,
    columns: plan.columns,
    rows: plan.rows,
    times: Array.from({ length: tiles }, (_, k) => Number(((s * tiles + k) / plan.fps).toFixed(3))).filter((t) => t < duration),
  }));

  const rate = Math.min(30, Math.max(1, Math.round(meta.sourceFps || meta.frameRate || 30)));
  const strips: ReferenceAnalysis["strips"] = [];
  for (const [i, cut] of pickStripCuts(cuts).entries()) {
    const start = Math.max(0, cut - STRIP_BEFORE);
    const count = Math.max(2, Math.round(STRIP_LENGTH * rate));
    const rows = meta.height > meta.width ? 2 : 3;
    const columns = Math.ceil(count / rows);
    const tileWidth = Math.round((plan.tileWidth * 0.8) / 2) * 2;
    const file = `strip-${String(i + 1).padStart(2, "0")}.jpg`;
    await runFfmpeg(
      [
        ...QUIET, "-loglevel", "error", "-ss", String(start), "-t", String(STRIP_LENGTH), "-i", source, "-an",
        "-vf", `fps=${rate},scale=${tileWidth}:-2,tile=${columns}x${rows}:padding=4:color=black`,
        "-frames:v", "1", "-q:v", "3", path.join(dir, file),
      ],
      { timeoutMs: 120_000 },
    );
    strips.push({ file, cut, times: Array.from({ length: count }, (_, k) => Number((start + k / rate).toFixed(3))).filter((t) => t < duration) });
  }

  const shots: ShotInfo[] = [];
  for (const shot of shotsBetween(cuts, duration).slice(0, MAX_SHOTS)) {
    shots.push({ ...shot, ...(await frameColors(source, (shot.start + shot.end) / 2)) });
  }

  let loudness: ReferenceAnalysis["loudness"] = null;
  if (meta.hasAudio) {
    const measured = await ffmpegOutput([...QUIET, "-i", source, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], timeout).catch(() => null);
    loudness = measured ? parseLoudness(measured.stderr) : null;
  }

  return {
    version: 1,
    kind: "video",
    duration,
    width: meta.width,
    height: meta.height,
    fps: meta.sourceFps,
    cuts,
    shots,
    sheets,
    strips,
    loudness,
    createdAt: new Date().toISOString(),
  };
}

async function analyzeImage(meta: MediaMeta, dir: string): Promise<ReferenceAnalysis> {
  const source = mediaPaths.source(meta.id, meta.ext);
  await runFfmpeg([...QUIET, "-loglevel", "error", "-i", source, "-frames:v", "1", "-vf", "scale='min(1600,iw)':-2", "-q:v", "3", path.join(dir, "sheet-01.jpg")], {
    timeoutMs: 60_000,
  });
  const look = await frameColors(source, 0);
  return {
    version: 1,
    kind: "image",
    duration: 0,
    width: meta.width,
    height: meta.height,
    fps: 0,
    cuts: [],
    shots: [{ start: 0, end: 0, ...look }],
    sheets: [{ file: "sheet-01.jpg", columns: 1, rows: 1, times: [] }],
    strips: [],
    loudness: null,
    createdAt: new Date().toISOString(),
  };
}

async function analyze(id: string): Promise<void> {
  const meta = await readMeta(id);
  if (!meta) return;
  const dir = analysisDir(id);
  try {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const analysis = mediaKindOf(meta) === "image" ? await analyzeImage(meta, dir) : await analyzeVideo(meta, dir);
    await writeJsonFile(analysisFile(id), analysis);
    await updateMeta(id, { analysis: { state: "ready" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateMeta(id, { analysis: { state: "error", error: message.split("\n").slice(0, 3).join(" ").slice(0, 600) } }).catch(() => undefined);
  }
}

export function readAnalysis(id: string): Promise<ReferenceAnalysis | null> {
  return readJsonFile<ReferenceAnalysis>(analysisFile(id)).catch(() => null);
}

let queue: Promise<unknown> = Promise.resolve();
const running = new Map<string, Promise<void>>();

/** Whether this server is analysing the file now (a "processing" status left by a restart is not). */
export function isAnalysing(id: string): boolean {
  return running.has(id);
}

/**
 * Start analysing a ready video or image (queued: one at a time). Resolves once it is queued, with
 * `done` for callers that wait for the result (wrapped: an async function would adopt the promise).
 */
export async function startAnalysis(id: string): Promise<{ done: Promise<void> }> {
  const current = running.get(id);
  if (current) return { done: current };
  const meta = await readMeta(id);
  if (!meta) throw new Error("Unknown media");
  const kind = mediaKindOf(meta);
  if (kind !== "video" && kind !== "image") throw new Error(`"${meta.name}" is not a video or an image`);
  if (meta.state !== "ready") throw new Error(`"${meta.name}" is not ready yet`);
  await updateMeta(id, { analysis: { state: "processing" } });
  const task = queue.then(() => analyze(id)).finally(() => running.delete(id));
  queue = task.catch(() => undefined);
  running.set(id, task);
  return { done: task };
}

/** The finished analysis, running it first when there is none (a board's references need it). */
export async function ensureAnalysis(id: string): Promise<ReferenceAnalysis | null> {
  const meta = await readMeta(id);
  if (!meta) return null;
  if (meta.analysis?.state === "ready") {
    const done = await readAnalysis(id);
    if (done) return done;
  }
  await (await startAnalysis(id)).done;
  return readAnalysis(id);
}

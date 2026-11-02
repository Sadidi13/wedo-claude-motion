/**
 * Turning an imported file into what the editor and the exporter use (docs/VIDEO.md):
 *
 *   1. `probe` reads duration, frame rate, size and whether there is sound from ffmpeg's banner
 *      (ffmpeg-static ships no ffprobe);
 *   2. one ffmpeg run writes `preview.mp4` (long side 1920, a keyframe every second, AAC) and the
 *      export frames (JPEG, long side MOTION_STUDIO_MEDIA_FRAME_SIDE or 2560, so a 1.3× punch-in on a
 *      1080×1920 stage stays sharp), both at the frame rate the frames are indexed by;
 *   3. meta.json records the frame count and size, and the state becomes "ready".
 *
 * `startIngest` runs once per id at a time; `ensureMediaReady` lets an export wait for files still
 * processing (and restarts ones a server restart interrupted).
 */

import { spawn } from "node:child_process";
import { open, readdir, rm, mkdir } from "node:fs/promises";
import type { MediaMeta } from "@/lib/media";
import { ffmpegPath, runFfmpeg } from "../export/ffmpeg";
import { mediaPaths, readMeta, updateMeta } from "./store";

export interface Probe {
  duration: number;
  fps: number;
  width: number;
  height: number;
  /** degrees from the display matrix (phone footage), 0 when none */
  rotation: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

/** Parse `ffmpeg -i <file>`'s banner (stderr). Pure, for tests. */
export function parseProbe(banner: string): Probe {
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(banner);
  const duration = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0;
  const video = /Stream #\d+:\d+[^\n]*?: Video: [^\n]*/.exec(banner)?.[0] ?? "";
  const size = /\b(\d{2,5})x(\d{2,5})\b/.exec(video);
  const fps = /(\d+(?:\.\d+)?)\s*fps\b/.exec(video) ?? /(\d+(?:\.\d+)?)\s*tbr\b/.exec(video);
  const rotation = /rotation of (-?\d+(?:\.\d+)?) degrees/.exec(banner);
  return {
    duration,
    fps: fps ? Number(fps[1]) : 0,
    width: size ? Number(size[1]) : 0,
    height: size ? Number(size[2]) : 0,
    rotation: rotation ? Number(rotation[1]) : 0,
    hasVideo: video !== "",
    hasAudio: /Stream #\d+:\d+[^\n]*?: Audio:/.test(banner),
  };
}

/** Frames per second the export frames are written at: the source's, rounded, 1..60 (30 when unknown). */
export function frameRateFor(sourceFps: number): number {
  if (!Number.isFinite(sourceFps) || sourceFps <= 0) return 30;
  return Math.min(60, Math.max(1, Math.round(sourceFps)));
}

/** Long side ≤ `side`, aspect kept, even dimensions, never upscaled. */
function fitLongSide(side: number): string {
  return `scale='if(gte(iw,ih),min(${side},iw),-2)':'if(gte(iw,ih),-2,min(${side},ih))'`;
}

export function frameSide(env: Record<string, string | undefined> = process.env): number {
  const forced = Number(env.MOTION_STUDIO_MEDIA_FRAME_SIDE);
  return Number.isInteger(forced) && forced >= 256 && forced <= 8192 ? forced : 2560;
}

export const PREVIEW_SIDE = 1920;

/** The ffmpeg argv writing preview.mp4 and the frames for one file. Pure, for tests. */
export function buildIngestArgs(source: string, preview: string, framePattern: string, frameRate: number, side: number): string[] {
  return [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", source,
    "-filter_complex",
    `[0:v]fps=${frameRate},split=2[p][f];[p]${fitLongSide(PREVIEW_SIDE)}:flags=bicubic,format=yuv420p[pv];[f]${fitLongSide(side)}:flags=lanczos[fr]`,
    "-map", "[pv]", "-map", "0:a:0?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-g", String(frameRate),
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
    preview,
    "-map", "[fr]", "-q:v", "3", "-start_number", "0",
    framePattern,
  ];
}

/** Width and height from a JPEG's SOF marker, or null. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    i += 2 + length;
  }
  return null;
}

async function probe(file: string): Promise<Probe> {
  const banner = await new Promise<string>((resolve, reject) => {
    const child = spawn(ffmpegPath(), ["-hide_banner", "-i", file], { stdio: ["ignore", "ignore", "pipe"] });
    let text = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (text.length < 200_000) text += chunk;
    });
    child.on("error", reject);
    child.on("close", () => resolve(text)); // exits 1 ("no output file"): the banner is all we need
  });
  return parseProbe(banner);
}

async function readHead(file: string, bytes: number): Promise<Uint8Array> {
  const handle = await open(file, "r");
  try {
    const buffer = new Uint8Array(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function ingest(id: string): Promise<MediaMeta> {
  const meta = await readMeta(id);
  if (!meta) throw new Error(`Media "${id}" does not exist`);
  try {
    const source = mediaPaths.source(id, meta.ext);
    const info = await probe(source);
    if (!info.hasVideo) throw new Error("No video stream found in this file");
    const frameRate = frameRateFor(info.fps);
    const swap = Math.abs(info.rotation) % 180 === 90;
    await updateMeta(id, {
      duration: info.duration,
      sourceFps: info.fps,
      width: swap ? info.height : info.width,
      height: swap ? info.width : info.height,
      hasAudio: info.hasAudio,
      frameRate,
    });
    const framesDir = mediaPaths.frames(id);
    await rm(framesDir, { recursive: true, force: true });
    await mkdir(framesDir, { recursive: true });
    const timeoutMs = Math.max(10 * 60_000, info.duration * 30_000);
    await runFfmpeg(buildIngestArgs(source, mediaPaths.preview(id), `${framesDir}/f_%06d.jpg`, frameRate, frameSide()), { timeoutMs });
    const frames = (await readdir(framesDir)).filter((name) => name.endsWith(".jpg"));
    if (frames.length === 0) throw new Error("ffmpeg wrote no frames");
    const size = jpegSize(await readHead(mediaPaths.frame(id, 0), 64 * 1024));
    return await updateMeta(id, {
      state: "ready",
      error: undefined,
      frameCount: frames.length,
      frameWidth: size?.width ?? 0,
      frameHeight: size?.height ?? 0,
      duration: info.duration || frames.length / frameRate,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return updateMeta(id, { state: "error", error: message.split("\n").slice(0, 4).join("\n") });
  }
}

const inflight = new Map<string, Promise<MediaMeta>>();

/** Process one imported file (once at a time per id). Never rejects: failures land in meta.json. */
export function startIngest(id: string): Promise<MediaMeta> {
  const running = inflight.get(id);
  if (running) return running;
  const task = ingest(id).finally(() => inflight.delete(id));
  inflight.set(id, task);
  return task;
}

/**
 * Resolve once every id is ready to export; a file still processing is awaited (and restarted when
 * no ingest is running for it, e.g. after a server restart). Throws a readable error otherwise.
 */
export async function ensureMediaReady(ids: string[]): Promise<MediaMeta[]> {
  const metas: MediaMeta[] = [];
  for (const id of ids) {
    let meta = await readMeta(id);
    if (!meta) throw new Error(`The video media/${id} is not in this computer's media library. Import the file again.`);
    if (meta.state === "processing") meta = await startIngest(id);
    if (meta.state !== "ready") throw new Error(`The video "${meta.name}" (media/${id}) could not be prepared: ${meta.error ?? meta.state}`);
    metas.push(meta);
  }
  return metas;
}

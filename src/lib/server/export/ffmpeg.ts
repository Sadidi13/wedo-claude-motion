/**
 * Frame sequence → deliverable (CONTRACTS.md §6).
 *
 * `buildEncodeArgs` is a pure function producing the exact ffmpeg argv for each
 * format (one pass, or two for GIF: palettegen then paletteuse); `encode` runs
 * them with `child_process.spawn` (never a shell string), keeps the tail of
 * stderr for error messages and always kills a still-running ffmpeg. The
 * png-sequence format does not use ffmpeg at all: the frames are zipped.
 * With `audio` (the mixed WAV, see audio.ts) mp4 gets AAC, webm Opus and mov
 * PCM in the same pass; the png-sequence zip gets `audio.wav`; gif stays silent.
 */

import { existsSync } from "node:fs";
import ffmpegStatic from "ffmpeg-static";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import JSZip from "jszip";
import type { ExportFormat } from "@/lib/types";
import { frameExtFor, framePattern, supportsAlpha, type FrameExt } from "./plan";

export interface EncodeOptions {
  format: ExportFormat;
  fps: number;
  /** keep alpha (only honoured by webm / mov / png-sequence) */
  transparent: boolean;
  /** H.264 CRF for mp4 */
  quality: number;
  /** pixel size of the frames (stage × scale) */
  width: number;
  height: number;
  /** the mixed sound track (WAV) to add, when the project has <Audio> layers */
  audio?: string | null;
}

export interface EncodePlan {
  /** ffmpeg argv per pass, in order (empty for png-sequence) */
  passes: string[][];
  /** absolute path of the deliverable */
  output: string;
  frameExt: FrameExt;
}

const OUTPUT_FILE: Record<ExportFormat, string> = {
  mp4: "output.mp4",
  webm: "output.webm",
  mov: "output.mov",
  gif: "output.gif",
  "png-sequence": "output.zip",
};

/**
 * FFMPEG_PATH wins; otherwise the binary bundled by the `ffmpeg-static` package
 * (so Windows/macOS users need no separate install); otherwise `ffmpeg` on PATH.
 */
export function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  // ffmpeg-static exports the path of the binary it downloaded at install time
  // (null when unsupported; missing when pnpm blocked its install script).
  if (ffmpegStatic && existsSync(ffmpegStatic)) return ffmpegStatic;
  return "ffmpeg";
}

/**
 * yuv420p / yuva420p need even dimensions; crop at most one row/column
 * (exact pixels, no resampling) instead of failing. Returns [] when even.
 */
function evenDimensionFilter(width: number, height: number): string[] {
  const odd = width % 2 !== 0 || height % 2 !== 0;
  return odd ? ["-vf", "crop=trunc(iw/2)*2:trunc(ih/2)*2:0:0"] : [];
}

export function buildEncodeArgs(jobDir: string, opts: EncodeOptions): EncodePlan {
  const transparent = opts.transparent && supportsAlpha(opts.format);
  const frameExt = frameExtFor(opts.format, transparent);
  const input = ["-y", "-framerate", String(opts.fps), "-i", path.join(jobDir, "frames", framePattern(frameExt))];
  const output = path.join(jobDir, OUTPUT_FILE[opts.format]);
  const rate = ["-r", String(opts.fps)];
  // Sound: a second input, mapped next to the video and cut to its length.
  const sound = (codec: string[]): { input: string[]; output: string[] } =>
    opts.audio
      ? { input: ["-i", opts.audio], output: ["-map", "0:v:0", "-map", "1:a:0", ...codec, "-shortest"] }
      : { input: [], output: [] };

  switch (opts.format) {
    case "mp4": {
      const audio = sound(["-c:a", "aac", "-b:a", "192k"]);
      return {
        passes: [
          [
            ...input,
            ...audio.input,
            ...evenDimensionFilter(opts.width, opts.height),
            "-c:v", "libx264", "-preset", "slow", "-crf", String(opts.quality),
            "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            ...audio.output,
            ...rate, output,
          ],
        ],
        output,
        frameExt,
      };
    }
    case "webm": {
      const audio = sound(["-c:a", "libopus", "-b:a", "160k"]);
      return {
        passes: [
          [
            ...input,
            ...audio.input,
            ...evenDimensionFilter(opts.width, opts.height),
            "-c:v", "libvpx-vp9", "-pix_fmt", transparent ? "yuva420p" : "yuv420p", "-b:v", "0", "-crf", "24",
            ...audio.output,
            ...rate, output,
          ],
        ],
        output,
        frameExt,
      };
    }
    case "mov": {
      const audio = sound(["-c:a", "pcm_s16le"]);
      return {
        passes: [
          [
            ...input,
            ...audio.input,
            "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", transparent ? "yuva444p10le" : "yuv444p10le",
            ...audio.output,
            ...rate, output,
          ],
        ],
        output,
        frameExt,
      };
    }
    case "gif": {
      const palette = path.join(jobDir, "palette.png");
      const filters = `fps=${opts.fps},scale=${opts.width}:-1:flags=lanczos`;
      return {
        passes: [
          [...input, "-vf", `${filters},palettegen`, palette],
          [...input, "-i", palette, "-lavfi", `${filters}[x];[x][1:v]paletteuse`, ...rate, output],
        ],
        output,
        frameExt,
      };
    }
    case "png-sequence":
      return { passes: [], output, frameExt };
  }
}

const STDERR_TAIL_CHARS = 4000;
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

/** Runs one ffmpeg invocation; rejects with the stderr tail on failure, kills on timeout. */
export function runFfmpeg(args: string[], opts: { timeoutMs?: number } = {}): Promise<void> {
  const binary = ffmpegPath();
  return new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });
    let tail = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`ffmpeg timed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms\n${tail}`));
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      tail = (tail + chunk).slice(-STDERR_TAIL_CHARS);
    });
    child.on("error", (error) => finish(new Error(`Could not start ffmpeg ("${binary}"): ${error.message}`)));
    child.on("close", (code, signal) => {
      if (code === 0) finish();
      else finish(new Error(`ffmpeg exited with ${signal ? `signal ${signal}` : `code ${code}`}\n${tail.trim()}`));
    });
  });
}

/** Stores every frame (sorted) into `output` without re-compressing the PNG data, plus the sound track if any. */
async function zipFrames(framesDir: string, ext: FrameExt, output: string, audio?: string | null): Promise<void> {
  const names = (await readdir(framesDir)).filter((name) => name.endsWith(`.${ext}`)).sort();
  if (names.length === 0) throw new Error(`No .${ext} frames found in ${framesDir}`);
  const zip = new JSZip();
  for (const name of names) zip.file(name, createReadStream(path.join(framesDir, name)));
  if (audio) zip.file("audio.wav", createReadStream(audio));
  await pipeline(zip.generateNodeStream({ type: "nodebuffer", streamFiles: true, compression: "STORE" }), createWriteStream(output));
}

/** Encodes the frames in `<jobDir>/frames` and returns the absolute output path. */
export async function encode(jobDir: string, opts: EncodeOptions): Promise<string> {
  const plan = buildEncodeArgs(jobDir, opts);
  if (opts.format === "png-sequence") {
    await zipFrames(path.join(jobDir, "frames"), plan.frameExt, plan.output, opts.audio);
    return plan.output;
  }
  for (const args of plan.passes) await runFfmpeg(args);
  return plan.output;
}

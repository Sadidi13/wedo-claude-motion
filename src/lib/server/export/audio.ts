/**
 * Sound for exports (docs/AUDIO.md). The renderer collects the <Audio> clips
 * the scene rendered (`window.__getAudioClips`); this module turns them into
 * one stereo WAV covering exactly the export range:
 *
 *   1. `prepareAudio` writes each clip's source to `<job>/audio/` (project files
 *      arrive as data: URLs) or points at the rendered built-in sound;
 *   2. `buildAudioMixArgs` (pure) trims, fades, delays and mixes them with
 *      ffmpeg (atrim / afade / adelay / amix, a limiter, silence-padded to the
 *      range's length);
 * the encoder then muxes the WAV into mp4 (AAC), webm (Opus) or mov (PCM), or
 * adds it to the PNG-sequence zip. GIF has no sound.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { sfxDuration } from "@/lib/audio/sfx";
import { dataUrlToBytes } from "@/lib/importer/dataUrl";
import type { AudioClip } from "@/runtime/audio";
import { ensureSfx } from "../audio";
import { runFfmpeg } from "./ffmpeg";

export type { AudioClip };

export interface PreparedClip {
  clip: AudioClip;
  file: string;
  /** seconds, when known (built-in sounds) */
  length?: number;
}

const EXT_BY_MIME: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/webm": "webm",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

function isClip(value: unknown): value is AudioClip {
  const clip = value as AudioClip;
  return (
    typeof clip === "object" &&
    clip !== null &&
    typeof clip.key === "string" &&
    (typeof clip.src === "string" || typeof clip.sfx === "string") &&
    Number.isFinite(clip.start) &&
    (clip.end === null || Number.isFinite(clip.end)) &&
    Number.isFinite(clip.from) &&
    Number.isFinite(clip.volume) &&
    Number.isFinite(clip.fadeIn) &&
    Number.isFinite(clip.fadeOut) &&
    typeof clip.loop === "boolean"
  );
}

/** Clips reported by several render workers, once each (the page's values are untrusted input). */
export function mergeClips(lists: unknown[]): AudioClip[] {
  const byKey = new Map<string, AudioClip>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const clip of list) if (isClip(clip)) byKey.set(clip.key, clip);
  }
  return [...byKey.values()];
}

/** Write each clip's source next to the job; returns the usable clips and why others were skipped. */
export async function prepareAudio(jobDir: string, clips: AudioClip[]): Promise<{ inputs: PreparedClip[]; skipped: string[] }> {
  const dir = path.join(jobDir, "audio");
  await mkdir(dir, { recursive: true });
  const inputs: PreparedClip[] = [];
  const skipped: string[] = [];
  for (const [index, clip] of clips.entries()) {
    try {
      if (clip.sfx) {
        inputs.push({ clip, file: await ensureSfx(clip.sfx), length: sfxDuration(clip.sfx) });
        continue;
      }
      if (clip.src?.startsWith("data:")) {
        const { mime, bytes } = dataUrlToBytes(clip.src);
        const file = path.join(dir, `clip-${index}.${EXT_BY_MIME[mime.toLowerCase()] ?? "bin"}`);
        await writeFile(file, bytes);
        inputs.push({ clip, file });
        continue;
      }
      skipped.push(`${clip.key}: only project audio files and built-in sounds are exported`);
    } catch (error) {
      skipped.push(`${clip.key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { inputs, skipped };
}

function n(value: number): string {
  return String(Number(value.toFixed(4)));
}

/**
 * ffmpeg argv mixing the clips into `output` (48 kHz stereo PCM WAV) for the export range, or null
 * when no clip sounds inside it. `stageEnd` bounds looping clips without an end.
 */
export function buildAudioMixArgs(
  inputs: PreparedClip[],
  range: { start: number; end: number },
  stageEnd: number,
  output: string,
): string[] | null {
  const total = range.end - range.start;
  const inputArgs: string[] = [];
  const chains: string[] = [];
  const labels: string[] = [];
  for (const { clip, file, length } of inputs) {
    const naturalEnd = clip.loop ? stageEnd : length !== undefined ? clip.start + Math.max(0, length - clip.from) : Infinity;
    const clipEnd = clip.end ?? naturalEnd;
    const visibleStart = Math.max(clip.start, range.start);
    const visibleEnd = Math.min(clipEnd, range.end);
    if (!(visibleEnd > visibleStart)) continue;
    const index = inputArgs.filter((arg) => arg === "-i").length;
    inputArgs.push(...(clip.loop ? ["-stream_loop", "-1"] : []), "-i", file);
    const duration = visibleEnd - visibleStart;
    let chain =
      `[${index}:a]atrim=start=${n(clip.from + (visibleStart - clip.start))}:duration=${n(duration)},asetpts=PTS-STARTPTS,` +
      `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${n(Math.min(Math.max(clip.volume, 0), 1))}`;
    if (clip.fadeIn > 0 && visibleStart === clip.start) chain += `,afade=t=in:st=0:d=${n(Math.min(clip.fadeIn, duration))}`;
    if (clip.fadeOut > 0 && Number.isFinite(clipEnd) && visibleEnd === clipEnd) {
      const fade = Math.min(clip.fadeOut, duration);
      chain += `,afade=t=out:st=${n(duration - fade)}:d=${n(fade)}`;
    }
    const delay = Math.round((visibleStart - range.start) * 1000);
    if (delay > 0) chain += `,adelay=delays=${delay}:all=1`;
    const label = `a${labels.length}`;
    chains.push(`${chain}[${label}]`);
    labels.push(`[${label}]`);
  }
  if (labels.length === 0) return null;
  const mix = labels.length === 1 ? `${labels[0]}anull` : `${labels.join("")}amix=inputs=${labels.length}:normalize=0:dropout_transition=0`;
  const graph = `${chains.join(";")};${mix},alimiter=limit=0.95,apad=whole_dur=${n(total)},atrim=duration=${n(total)}[out]`;
  return [
    "-y", "-hide_banner", "-loglevel", "error",
    ...inputArgs,
    "-filter_complex", graph,
    "-map", "[out]", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le",
    output,
  ];
}

/**
 * Mix the job's clips into `<job>/audio.wav`. Resolves with its path (null when nothing sounds in the
 * range) and the clips that had to be skipped.
 */
export async function mixAudio(
  jobDir: string,
  clips: AudioClip[],
  range: { start: number; end: number },
  stageEnd: number,
): Promise<{ file: string | null; skipped: string[] }> {
  if (clips.length === 0) return { file: null, skipped: [] };
  const { inputs, skipped } = await prepareAudio(jobDir, clips);
  const output = path.join(jobDir, "audio.wav");
  const args = buildAudioMixArgs(inputs, range, stageEnd, output);
  if (!args) return { file: null, skipped };
  await runFfmpeg(args, { timeoutMs: 10 * 60_000 });
  return { file: output, skipped };
}

/**
 * Built-in sound effects (src/lib/audio/sfx.ts) rendered to WAV with ffmpeg on
 * first use and cached under `<tmp>/motion-studio/sfx-v1/` (override:
 * MOTION_STUDIO_SFX_DIR). The editor preview fetches them from
 * /api/audio/sfx/<name>; the exporter reads the files directly.
 *
 * Real recorded sounds (src/lib/audio/realSounds.ts) are downloaded from
 * Freesound on first use, trimmed and levelled (effects to a peak, music beds
 * to a loudness), and cached with the media library (`<media>/sounds/`,
 * override MOTION_STUDIO_SOUNDS_DIR); the preview fetches them from
 * /api/audio/sound/<name>.
 */

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { REAL_SOUNDS, type RealSound, isRealSoundName } from "@/lib/audio/realSounds";
import { SFX, isSfxName } from "@/lib/audio/sfx";
import { ffmpegPath, runFfmpeg } from "./export/ffmpeg";
import { mediaRoot } from "./media/store";

/** Bump when a recipe changes so old renders are not reused. */
const CACHE_VERSION = "sfx-v1";

export function sfxDir(): string {
  return process.env.MOTION_STUDIO_SFX_DIR || path.join(os.tmpdir(), "motion-studio", CACHE_VERSION);
}

const inflight = new Map<string, Promise<string>>();

/** Path of the rendered WAV for a built-in sound (renders it the first time). Throws for unknown names. */
export function ensureSfx(name: string): Promise<string> {
  if (!isSfxName(name)) return Promise.reject(new Error(`Unknown sound effect "${name}"`));
  const existing = inflight.get(name);
  if (existing) return existing;
  const task = (async () => {
    const file = path.join(sfxDir(), `${name}.wav`);
    const info = await stat(file).catch(() => null);
    if (info?.isFile() && info.size > 0) return file;
    await mkdir(sfxDir(), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp.wav`;
    try {
      await runFfmpeg(
        ["-y", "-hide_banner", "-loglevel", "error", "-filter_complex", SFX[name].filter, "-map", "[out]", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", tmp],
        { timeoutMs: 60_000 },
      );
      await rename(tmp, file);
    } finally {
      await rm(tmp, { force: true });
    }
    return file;
  })();
  inflight.set(name, task);
  task.finally(() => inflight.delete(name)).catch(() => undefined);
  return task;
}

// ---------------------------------------------------------------------------
// Real recorded sounds (src/lib/audio/realSounds.ts)
// ---------------------------------------------------------------------------

/** Downloaded real sounds, kept with the media library (they are not temporary: the next video uses them too). */
export function soundsDir(): string {
  return process.env.MOTION_STUDIO_SOUNDS_DIR || path.join(mediaRoot(), "sounds");
}

/** Bump when the processing changes so old files are not reused. */
const SOUNDS_VERSION = 1;

/** Every effect is levelled to this sample peak, so `volume` means the same for all of them. */
const SOUND_PEAK_DB = -3;

/** Every music bed is levelled to this integrated loudness (true peak at most -1.5 dBTP). */
const MUSIC_LUFS = -16;

const soundsInflight = new Map<string, Promise<string>>();

/** Where a real sound's processed WAV is cached. */
export function realSoundFile(name: string): string {
  return path.join(soundsDir(), `${name}.v${SOUNDS_VERSION}.wav`);
}

/** ffmpeg's filter keeping the trim, with short fades (no clicks at the edges) unless the sound loops seamlessly. */
export function soundTrimFilter(trim: readonly [number, number], fades = true): string {
  const cut = `atrim=start=${trim[0]}:end=${trim[1]},asetpts=PTS-STARTPTS`;
  if (!fades) return cut;
  const length = Math.max(0.02, trim[1] - trim[0]);
  const fadeOut = Math.min(0.03, length / 4);
  return `${cut},afade=t=in:d=0.004,afade=t=out:st=${(length - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`;
}

/** The filter that levels a sound: effects to a sample peak, music (by measuring it first) to a loudness. */
async function levelFilter(file: string, clean: string, music: boolean): Promise<string> {
  if (!music) return `volume=${Number((SOUND_PEAK_DB - (await maxVolume(file, clean))).toFixed(2))}dB`;
  const target = `I=${MUSIC_LUFS}:TP=-1.5:LRA=20`;
  const stderr = await ffmpegStderr(["-hide_banner", "-nostats", "-i", file, "-af", `${clean},loudnorm=${target}:print_format=json`, "-f", "null", "-"]);
  const measured = JSON.parse(stderr.slice(stderr.lastIndexOf("{"), stderr.lastIndexOf("}") + 1)) as Record<string, string>;
  return (
    `loudnorm=${target}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}` +
    `:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`
  );
}

/**
 * Path of a real sound's WAV: downloaded from Freesound the first time (CC0), trimmed and levelled,
 * then cached. Throws for unknown names, or when the download fails (no internet). A music bed also
 * loses any DC offset and rumble below 20 Hz.
 */
export function ensureRealSound(name: string): Promise<string> {
  if (!isRealSoundName(name)) return Promise.reject(new Error(`Unknown sound "${name}"`));
  const existing = soundsInflight.get(name);
  if (existing) return existing;
  const task = (async () => {
    const sound: RealSound = REAL_SOUNDS[name];
    const file = realSoundFile(name);
    const info = await stat(file).catch(() => null);
    if (info?.isFile() && info.size > 0) return file;
    await mkdir(soundsDir(), { recursive: true });
    const download = `${file}.${process.pid}.download.ogg`;
    const tmp = `${file}.${process.pid}.tmp.wav`;
    try {
      // A music bed's preview is a few megabytes, and Freesound's CDN can be slow (75 KB/s measured).
      const timeout = sound.music ? 300_000 : 60_000;
      const response = await fetch(sound.source.preview, { headers: { "user-agent": "WeDo Claude Motion" }, signal: AbortSignal.timeout(timeout) });
      if (!response.ok) throw new Error(`Freesound answered HTTP ${response.status}`);
      await writeFile(download, new Uint8Array(await response.arrayBuffer()));
      const trim = soundTrimFilter(sound.source.trim, !sound.music?.loops);
      const clean = sound.music ? `highpass=f=20,${trim}` : trim;
      const level = await levelFilter(download, clean, Boolean(sound.music));
      await runFfmpeg(
        ["-y", "-hide_banner", "-loglevel", "error", "-i", download, "-af", `${clean},${level}`, "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", tmp],
        { timeoutMs: 120_000 },
      );
      await rename(tmp, file);
    } catch (error) {
      throw new Error(`Could not get the sound "${name}" from Freesound: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await rm(download, { force: true });
      await rm(tmp, { force: true });
    }
    return file;
  })();
  soundsInflight.set(name, task);
  task.finally(() => soundsInflight.delete(name)).catch(() => undefined);
  return task;
}

/** What ffmpeg printed on stderr for an analysis pass (its measurements). */
function ffmpegStderr(args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { windowsHide: true });
    let text = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (text += chunk));
    child.on("error", reject);
    child.on("close", () => resolve(text));
  });
}

/** The loudest sample of the trimmed sound, in dBFS (ffmpeg volumedetect). */
async function maxVolume(file: string, filter: string): Promise<number> {
  const stderr = await ffmpegStderr(["-hide_banner", "-nostats", "-i", file, "-af", `${filter},volumedetect`, "-f", "null", "-"]);
  const match = /max_volume:\s*(-?[\d.]+) dB/.exec(stderr);
  return match ? Number(match[1]) : 0;
}

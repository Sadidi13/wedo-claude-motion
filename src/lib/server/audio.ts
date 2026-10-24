/**
 * Built-in sound effects (src/lib/audio/sfx.ts) rendered to WAV with ffmpeg on
 * first use and cached under `<tmp>/motion-studio/sfx-v1/` (override:
 * MOTION_STUDIO_SFX_DIR). The editor preview fetches them from
 * /api/audio/sfx/<name>; the exporter reads the files directly.
 */

import { stat } from "node:fs/promises";
import { mkdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SFX, isSfxName } from "@/lib/audio/sfx";
import { runFfmpeg } from "./export/ffmpeg";

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

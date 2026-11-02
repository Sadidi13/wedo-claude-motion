/**
 * What is said in a library video or sound, with word timings (docs/VIDEO.md), made on this
 * computer with Whisper so it costs no Claude usage. ffmpeg extracts 16 kHz mono speech, then
 * scripts/transcribe.py (faster-whisper) writes `transcript.json` next to the file. The designer
 * can correct the text; the storyboard brief hands it to Claude for captions and timing.
 *
 * Python: MOTION_STUDIO_WHISPER_PYTHON, else the environment the /watch skill installs WhisperX
 * into (~/.cache/watch/whisperx-venv). Model: MOTION_STUDIO_WHISPER_MODEL (default large-v3, the
 * one that writes Persian well; ~3x the clip's length on a laptop CPU). One transcript at a time.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mediaKindOf, type MediaMeta } from "@/lib/media";
import { readJsonFile, writeJsonFile } from "../jsonFile";
import { runFfmpeg } from "../export/ffmpeg";
import { mediaDir, mediaPaths, readMeta, updateMeta } from "./store";

export interface TranscriptWord {
  start: number;
  end: number;
  word: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  /** Whisper's word timings; after a correction they still time the segment's speech */
  words: TranscriptWord[];
  /** the designer corrected this segment's text */
  edited?: boolean;
}

export interface Transcript {
  language: string;
  model: string;
  segments: TranscriptSegment[];
  createdAt: string;
}

export const transcriptFile = (id: string) => path.join(mediaDir(id), "transcript.json");

/** The Python that can run scripts/transcribe.py, or null when none is set up. */
export function whisperPython(env: Record<string, string | undefined> = process.env): string | null {
  if (env.MOTION_STUDIO_WHISPER_PYTHON) return existsSync(env.MOTION_STUDIO_WHISPER_PYTHON) ? env.MOTION_STUDIO_WHISPER_PYTHON : null;
  const venv = path.join(os.homedir(), ".cache", "watch", "whisperx-venv");
  const python = process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");
  return existsSync(python) ? python : null;
}

export function whisperModel(env: Record<string, string | undefined> = process.env): string {
  const model = env.MOTION_STUDIO_WHISPER_MODEL?.trim();
  return model && /^[\w.-]{2,60}$/.test(model) ? model : "large-v3";
}

/** Only speech-carrying files can be transcribed. */
export function canTranscribe(meta: MediaMeta): boolean {
  const kind = mediaKindOf(meta);
  return meta.state === "ready" && meta.hasAudio && (kind === "video" || kind === "audio");
}

/** Parse the script's JSON, keeping only well-formed segments and words. Pure, for tests. */
export function parseTranscript(stdout: string, model: string, now = new Date()): Transcript {
  const raw = JSON.parse(stdout) as { language?: unknown; segments?: unknown };
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : null);
  const segments: TranscriptSegment[] = [];
  for (const item of Array.isArray(raw.segments) ? raw.segments : []) {
    const segment = item as { start?: unknown; end?: unknown; text?: unknown; words?: unknown };
    const start = number(segment.start);
    const end = number(segment.end);
    if (start === null || end === null || typeof segment.text !== "string" || !segment.text.trim()) continue;
    const words: TranscriptWord[] = [];
    for (const entry of Array.isArray(segment.words) ? segment.words : []) {
      const word = entry as { start?: unknown; end?: unknown; word?: unknown };
      const wordStart = number(word.start);
      const wordEnd = number(word.end);
      if (wordStart !== null && wordEnd !== null && typeof word.word === "string" && word.word.trim()) {
        words.push({ start: wordStart, end: Math.max(wordStart, wordEnd), word: word.word.trim() });
      }
    }
    segments.push({ start, end: Math.max(start, end), text: segment.text.trim(), words });
  }
  return { language: typeof raw.language === "string" ? raw.language : "", model, segments, createdAt: now.toISOString() };
}

export function readTranscript(id: string): Promise<Transcript | null> {
  return readJsonFile<Transcript>(transcriptFile(id)).catch(() => null);
}

/** Save the designer's corrections (one text per segment, same order). Throws when the shape does not match. */
export async function correctTranscript(id: string, texts: string[]): Promise<Transcript> {
  const transcript = await readTranscript(id);
  if (!transcript) throw new Error("There is no transcript to correct yet");
  if (texts.length !== transcript.segments.length) throw new Error(`Send ${transcript.segments.length} segment texts`);
  const segments = transcript.segments.map((segment, i) => {
    const text = texts[i].replace(/\s+/g, " ").trim().slice(0, 2_000);
    return text === segment.text ? segment : { ...segment, text, edited: true };
  });
  const next = { ...transcript, segments };
  await writeJsonFile(transcriptFile(id), next);
  const meta = await readMeta(id);
  if (meta?.transcript) await updateMeta(id, { transcript: { ...meta.transcript, edited: segments.some((s) => s.edited) } });
  return next;
}

function runPython(python: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Whisper did not finish within ${Math.round(timeoutMs / 60_000)} minutes`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4_000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Could not run Whisper (${python}): ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`Whisper failed: ${stderr.trim().split(/\r?\n/).slice(-3).join(" ") || `exit code ${code}`}`));
    });
  });
}

async function transcribe(id: string, language: string | undefined): Promise<void> {
  const meta = await readMeta(id);
  if (!meta) return;
  const python = whisperPython();
  const speech = path.join(mediaDir(id), "speech.wav");
  try {
    if (!python) throw new Error("Whisper is not set up on this computer (set MOTION_STUDIO_WHISPER_PYTHON to a Python with faster-whisper)");
    await runFfmpeg(["-y", "-hide_banner", "-loglevel", "error", "-i", mediaPaths.source(id, meta.ext), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", speech], {
      timeoutMs: 10 * 60_000,
    });
    const model = whisperModel();
    const script = path.join(process.cwd(), "scripts", "transcribe.py");
    const args = ["-I", script, speech, "--model", model, ...(language ? ["--language", language] : [])];
    const stdout = await runPython(python, args, Math.max(15 * 60_000, meta.duration * 12_000));
    const transcript = parseTranscript(stdout, model);
    await writeJsonFile(transcriptFile(id), transcript);
    await updateMeta(id, { transcript: { state: "ready", language: transcript.language || language } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateMeta(id, { transcript: { state: "error", error: message.slice(0, 600), language } }).catch(() => undefined);
  } finally {
    await rm(speech, { force: true });
  }
}

let queue: Promise<unknown> = Promise.resolve();
const queued = new Set<string>();

/** The transcript status as it really is: "processing" left behind by a server restart counts as an error. */
export function transcriptStatus(meta: MediaMeta): MediaMeta["transcript"] | null {
  const status = meta.transcript ?? null;
  if (status?.state === "processing" && !queued.has(meta.id)) {
    return { ...status, state: "error", error: "Transcribing was interrupted (the server restarted). Start it again." };
  }
  return status;
}

/**
 * Start transcribing (queued behind others; Whisper uses every core). Resolves once it is queued
 * with the status the editor polls. `language` is a hint like "fa" or "en".
 */
export async function startTranscript(id: string, language?: string): Promise<MediaMeta> {
  const meta = await readMeta(id);
  if (!meta) throw new Error("Unknown media");
  if (!canTranscribe(meta)) throw new Error(`"${meta.name}" has no speech to transcribe`);
  if (queued.has(id)) return meta;
  const hint = language && /^[a-z]{2,3}$/.test(language) ? language : undefined;
  queued.add(id);
  const next = await updateMeta(id, { transcript: { state: "processing", language: hint } });
  const task = queue.then(() => transcribe(id, hint)).finally(() => queued.delete(id));
  queue = task.catch(() => undefined);
  return next;
}

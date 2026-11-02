import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MediaMeta } from "@/lib/media";
import { mediaDir, writeMeta } from "../store";
import { canTranscribe, correctTranscript, parseTranscript, readTranscript, transcriptFile, whisperModel, whisperPython } from "../transcribe";
import { writeJsonFile } from "../../jsonFile";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "motion-transcribe-test-"));
  process.env.MOTION_STUDIO_MEDIA_DIR = root;
});

afterAll(async () => {
  delete process.env.MOTION_STUDIO_MEDIA_DIR;
  await rm(root, { recursive: true, force: true });
});

const SCRIPT_OUTPUT = JSON.stringify({
  language: "fa",
  duration: 7.5,
  segments: [
    { start: 0, end: 3.44, text: " مدل بی‌نظیر سورا ۲ معرفی شده ", words: [{ start: 0, end: 0.4, word: " مدل" }, { start: 0.42, end: "x", word: "bad" }] },
    { start: 3.44, end: 7.5, text: "رایگان ازش استفاده کنیم", words: [] },
    { start: 8, end: 9, text: "   " },
    { start: "?", end: 9, text: "no start" },
  ],
});

function meta(id: string, patch: Partial<MediaMeta> = {}): MediaMeta {
  return {
    id, kind: "video", name: "talk.mp4", ext: "mp4", size: 10, state: "ready", duration: 7.5, sourceFps: 30, width: 1080, height: 1920,
    hasAudio: true, frameRate: 30, frameCount: 225, frameWidth: 1440, frameHeight: 2560, createdAt: new Date().toISOString(), ...patch,
  };
}

describe("parseTranscript", () => {
  it("keeps well-formed segments and words, trimmed", () => {
    const transcript = parseTranscript(SCRIPT_OUTPUT, "large-v3", new Date("2026-11-02T10:00:00Z"));
    expect(transcript).toEqual({
      language: "fa",
      model: "large-v3",
      createdAt: "2026-11-02T10:00:00.000Z",
      segments: [
        { start: 0, end: 3.44, text: "مدل بی‌نظیر سورا ۲ معرفی شده", words: [{ start: 0, end: 0.4, word: "مدل" }] },
        { start: 3.44, end: 7.5, text: "رایگان ازش استفاده کنیم", words: [] },
      ],
    });
  });
});

describe("settings", () => {
  it("uses large-v3 unless another model name is set", () => {
    expect(whisperModel({})).toBe("large-v3");
    expect(whisperModel({ MOTION_STUDIO_WHISPER_MODEL: "large-v3-turbo" })).toBe("large-v3-turbo");
    expect(whisperModel({ MOTION_STUDIO_WHISPER_MODEL: "a; rm -rf /" })).toBe("large-v3");
  });

  it("only uses a Python that exists", () => {
    expect(whisperPython({ MOTION_STUDIO_WHISPER_PYTHON: path.join(root, "missing", "python.exe") })).toBeNull();
    expect(whisperPython({ MOTION_STUDIO_WHISPER_PYTHON: process.execPath })).toBe(process.execPath);
  });

  it("transcribes only ready files with sound", () => {
    expect(canTranscribe(meta("a1b2c3d4e5f6"))).toBe(true);
    expect(canTranscribe(meta("a1b2c3d4e5f6", { kind: "audio" }))).toBe(true);
    expect(canTranscribe(meta("a1b2c3d4e5f6", { hasAudio: false }))).toBe(false);
    expect(canTranscribe(meta("a1b2c3d4e5f6", { state: "processing" }))).toBe(false);
    expect(canTranscribe(meta("a1b2c3d4e5f6", { kind: "image", hasAudio: false }))).toBe(false);
  });
});

describe("correctTranscript", () => {
  it("replaces the texts the designer changed and marks them", async () => {
    const id = "k3f9x2abcd12";
    await mkdir(mediaDir(id), { recursive: true });
    await writeMeta(meta(id, { transcript: { state: "ready", language: "fa" } }));
    await writeJsonFile(transcriptFile(id), parseTranscript(SCRIPT_OUTPUT, "large-v3"));
    const next = await correctTranscript(id, ["مدل بی‌نظیر سورا ۲ معرفی شده", "  و ما رایگان   ازش استفاده می‌کنیم "]);
    expect(next.segments.map((s) => [s.text, s.edited ?? false])).toEqual([
      ["مدل بی‌نظیر سورا ۲ معرفی شده", false],
      ["و ما رایگان ازش استفاده می‌کنیم", true],
    ]);
    expect((await readTranscript(id))?.segments[1].words).toEqual([]);
    await expect(correctTranscript(id, ["one"])).rejects.toThrow(/2 segment/);
    await expect(correctTranscript("zzzzzzzzzzzz", [])).rejects.toThrow(/no transcript/);
  });
});

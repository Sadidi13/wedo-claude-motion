import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MediaMeta } from "@/lib/media";
import type { AudioClip } from "@/runtime/audio";

// Ingest spawns ffmpeg on the stored file; these tests only cover storing and looking it up.
vi.mock("../ingest", () => ({ startIngest: vi.fn(async () => undefined), ensureMediaReady: vi.fn() }));

const { cleanFileName, extensionOf, importVideo } = await import("../upload");
const { listMedia, mediaDir, mediaPaths, readMeta, writeMeta } = await import("../store");
const { prepareAudio } = await import("../../export/audio");

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "motion-media-test-"));
  process.env.MOTION_STUDIO_MEDIA_DIR = root;
});

afterAll(async () => {
  delete process.env.MOTION_STUDIO_MEDIA_DIR;
  await rm(root, { recursive: true, force: true });
});

const streamOf = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 3));
      controller.enqueue(bytes.subarray(3));
      controller.close();
    },
  });

describe("importing", () => {
  it("cleans names and keeps only video extensions", () => {
    expect(cleanFileName(encodeURIComponent("C:\\Users\\me\\Talk take 2.mp4"))).toBe("Talk take 2.mp4");
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName(null)).toBe("video.mp4");
    expect(extensionOf("Talk.MOV")).toBe("mov");
    expect(extensionOf("song.mp3")).toBeNull();
  });

  it("streams the body to <id>/source.<ext> and starts in the processing state", async () => {
    const bytes = new TextEncoder().encode("not really a video");
    const meta = await importVideo(streamOf(bytes), encodeURIComponent("Talk take 2.mp4"));
    expect(meta).toMatchObject({ name: "Talk take 2.mp4", ext: "mp4", size: bytes.length, state: "processing" });
    expect(mediaDir(meta.id).startsWith(root)).toBe(true);
    expect(new Uint8Array(await readFile(mediaPaths.source(meta.id, "mp4")))).toEqual(bytes);
    expect(await readMeta(meta.id)).toEqual(meta);
    expect((await listMedia()).map((m) => m.id)).toContain(meta.id);
  });

  it("refuses files that are not videos and empty uploads", async () => {
    await expect(importVideo(streamOf(new Uint8Array([1, 2, 3, 4])), "notes.txt")).rejects.toMatchObject({ status: 415 });
    await expect(importVideo(streamOf(new Uint8Array([])), "empty.mp4")).rejects.toThrow(/empty/);
    await expect(importVideo(null, "a.mp4")).rejects.toThrow(/no body/);
  });

  it("never builds a path from an invalid id", async () => {
    expect(() => mediaDir("../../outside")).toThrow();
    expect(await readMeta("../../outside")).toBeNull();
  });
});

describe("a <Video>'s sound in the export mix", () => {
  const meta = (id: string, hasAudio: boolean): MediaMeta => ({
    id, name: `${id}.mp4`, ext: "mp4", size: 10, state: "ready", duration: 46.35, sourceFps: 29.97, width: 2160, height: 3840,
    hasAudio, frameRate: 30, frameCount: 1390, frameWidth: 1440, frameHeight: 2560, createdAt: new Date().toISOString(),
  });
  const clip = (id: string): AudioClip => ({ key: `video-${id}`, src: `media/${id}.mp4`, start: 0, end: 46.35, from: 0, volume: 1, fadeIn: 0, fadeOut: 0, loop: false });

  it("reads the original file of the videos the project uses, and skips the rest", async () => {
    for (const [id, sound] of [["withsound000", true], ["silentclip00", false]] as const) {
      await mkdir(mediaDir(id), { recursive: true });
      await writeFile(mediaPaths.source(id, "mp4"), "x");
      await writeMeta(meta(id, sound));
    }
    const job = await mkdtemp(path.join(os.tmpdir(), "motion-job-test-"));
    try {
      const { inputs, skipped } = await prepareAudio(job, [clip("withsound000"), clip("silentclip00"), clip("notusedhere0")], ["withsound000", "silentclip00"]);
      expect(inputs.map((input) => input.file)).toEqual([mediaPaths.source("withsound000", "mp4")]);
      expect(inputs[0].length).toBe(46.35);
      expect(skipped).toHaveLength(2);
      expect(skipped.join("\n")).toMatch(/no sound/);
      expect(skipped.join("\n")).toMatch(/not a video this project uses/);
    } finally {
      await rm(job, { recursive: true, force: true });
    }
  });
});

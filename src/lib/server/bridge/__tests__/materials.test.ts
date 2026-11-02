/**
 * The New video wizard's setup on a board (docs/STORYBOARD.md): materials from the media library,
 * checked by kind, and the brief that hands them (with lengths, font names and the transcript) to
 * every step, the build included.
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { MediaMeta } from "@/lib/media";
import { writeJsonFile } from "../../jsonFile";
import { mediaDir, writeMeta as storeMeta } from "../../media/store";
import { parseTranscript, transcriptFile } from "../../media/transcribe";
import { GOOD_SCENE_CODE } from "@/lib/ai/__tests__/fixture";
import {
  BridgeStateError,
  boardAction,
  buildBoardBrief,
  claimNextRequest,
  loadMaterialInfo,
  proposeStyles,
  readBoard,
  startBoard,
  updateStyleSpec,
} from "..";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "motion-studio-materials-test-"));
  process.env.MOTION_STUDIO_BRIDGE_DIR = path.join(root, "bridge");
  process.env.MOTION_STUDIO_MEDIA_DIR = path.join(root, "media");
});

afterAll(async () => {
  delete process.env.MOTION_STUDIO_BRIDGE_DIR;
  delete process.env.MOTION_STUDIO_MEDIA_DIR;
  await rm(root, { recursive: true, force: true });
});

async function writeMeta(value: MediaMeta): Promise<void> {
  await mkdir(mediaDir(value.id), { recursive: true });
  await storeMeta(value);
}

function meta(id: string, patch: Partial<MediaMeta>): MediaMeta {
  return {
    id, kind: "video", name: `${id}.mp4`, ext: "mp4", size: 10, state: "ready", duration: 0, sourceFps: 0, width: 0, height: 0,
    hasAudio: false, frameRate: 0, frameCount: 0, frameWidth: 0, frameHeight: 0, createdAt: new Date().toISOString(), ...patch,
  };
}

async function library() {
  await writeMeta(meta("footage00001", { name: "talk.mp4", duration: 15.02, width: 1080, height: 1920, hasAudio: true, transcript: { state: "ready", language: "fa" } }));
  await writeMeta(meta("music0000001", { kind: "audio", name: "bed.mp3", ext: "mp3", duration: 20.04, hasAudio: true }));
  await writeMeta(meta("logo00000001", { kind: "image", name: "logo.png", ext: "png", width: 512, height: 512 }));
  await writeMeta(meta("font00000001", { kind: "font", name: "DAMOON-Bold.woff2", ext: "woff2", fontFamily: "DAMOON", fontWeight: 700, fontStyle: "normal" }));
  const transcript = parseTranscript(
    JSON.stringify({
      language: "fa",
      segments: [
        { start: 0, end: 3.44, text: "مدل بی‌نظیر سورا ۲", words: [{ start: 0, end: 0.4, word: "مدل" }, { start: 0.42, end: 1.1, word: "بی‌نظیر" }] },
      ],
    }),
    "large-v3",
  );
  await writeJsonFile(transcriptFile("footage00001"), transcript);
}

const WIZARD = {
  brief: "A 15-second reel about Sora 2 for my page",
  stage: { width: 1080, height: 1920, duration: 15.02, fps: 30 },
  videoKind: "footage" as const,
  language: "Persian",
  script: "Sora 2 is here. Follow for more.",
  materials: [
    { mediaId: "footage00001", role: "footage" as const },
    { mediaId: "music0000001", role: "music" as const, note: "quiet under the voice" },
    { mediaId: "logo00000001", role: "logo" as const },
    { mediaId: "font00000001", role: "font" as const },
  ],
  styleHints: ["Social captions", "Not a real style"],
};

describe("the style spec read from references", () => {
  it("is kept with the style frames, editable, and handed to the storyboard and the build", async () => {
    const board = await startBoard({ brief: "In the style of the reference", stage: { width: 1280, height: 720, duration: 8, fps: 30 } });
    await claimNextRequest(new Date(), "headless");
    const spec = "Formula: hook, three facts, call to action. Palette: #0b0b0f, #e8d8c0, #c62828.";
    const styled = await proposeStyles({ boardId: board.id, styleSpec: spec, styles: [{ name: "A", description: "close match", time: 1, code: GOOD_SCENE_CODE }] });
    expect(styled.styleSpec).toBe(spec);

    const corrected = await updateStyleSpec(board.id, `${spec}\nType: condensed bold sans, all caps.`);
    expect(corrected.styleSpec).toContain("condensed bold sans");
    const chosen = await boardAction(board.id, { action: "choose-style", styleId: "a" });
    const record = (await claimNextRequest(new Date(), "headless"))!;
    const brief = buildBoardBrief(record, chosen, "headless");
    expect(brief).toContain("## Style spec (read from the references with the style frames; the designer may have edited it)");
    expect(brief).toContain("Type: condensed bold sans, all caps.");
    expect(brief.indexOf("## About the text below")).toBeLessThan(brief.indexOf("## Style spec"));

    expect((await updateStyleSpec(board.id, "   ")).styleSpec).toBeUndefined();
  });
});

describe("a board started from the wizard", () => {
  it("keeps the setup, resolves the materials and drops unknown style names", async () => {
    await library();
    const board = await startBoard(WIZARD);
    expect(board).toMatchObject({ videoKind: "footage", language: "Persian", script: "Sora 2 is here. Follow for more.", styleHints: ["Social captions"] });
    expect(board.materials).toEqual([
      { mediaId: "footage00001", role: "footage", name: "talk.mp4", ref: "media/footage00001.mp4", kind: "video" },
      { mediaId: "music0000001", role: "music", name: "bed.mp3", ref: "media/music0000001.mp3", kind: "audio", note: "quiet under the voice" },
      { mediaId: "logo00000001", role: "logo", name: "logo.png", ref: "media/logo00000001.png", kind: "image" },
      { mediaId: "font00000001", role: "font", name: "DAMOON-Bold.woff2", ref: "media/font00000001.woff2", kind: "font" },
    ]);
    expect((await readBoard(board.id))?.materials).toHaveLength(4);
  });

  it("refuses files that are missing or do not fit their role", async () => {
    await library();
    const refused = async (materials: (typeof WIZARD)["materials"]) => {
      const error = await startBoard({ ...WIZARD, materials }).then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(BridgeStateError);
    };
    await refused([{ mediaId: "missing00001", role: "footage" }]);
    await refused([{ mediaId: "logo00000001", role: "footage" }]);
    await refused([{ mediaId: "music0000001", role: "font" }]);
  });

  it("hands the materials to every step: transcripts for all, word timings for the build", async () => {
    await library();
    const board = await startBoard(WIZARD);
    const record = (await claimNextRequest(new Date(), "headless"))!;
    const info = await loadMaterialInfo(board);
    const styles = buildBoardBrief(record, board, "headless", info);
    expect(styles).toContain("## Materials");
    expect(styles).toContain('Footage "talk.mp4": `media/footage00001.mp4` (video, 15.02s, 1080x1920, with sound)');
    expect(styles).toContain('<Audio src="media/music0000001.mp3" start={0} volume={0.3} fadeOut={1.5} data-layer-name="Music" />');
    expect(styles).toContain("Note: quiet under the voice");
    expect(styles).toContain('font-family: "DAMOON"; src: url("media/font00000001.woff2"); font-weight: 700');
    expect(styles).toContain("- [0.00-3.44] مدل بی‌نظیر سورا ۲");
    expect(styles).not.toContain("Word timings");
    expect(styles).toContain("**Social captions**");
    expect(styles).toContain("Kind: built around footage of a person speaking");
    // The materials come after the line that marks everything below as the designer's text.
    expect(styles.indexOf("## About the text below")).toBeLessThan(styles.indexOf("## Materials"));

    const build = buildBoardBrief({ ...record, board: { boardId: board.id, action: "approve" } }, board, "headless", info);
    expect(build).toContain("Word timings");
    expect(build).toContain("- 0.00 مدل · 0.42 بی‌نظیر");
    expect(build).not.toContain("## Style directions the designer picked");
  });
});

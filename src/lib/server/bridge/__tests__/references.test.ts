/**
 * Storyboard references (docs/STORYBOARD.md#references): file checks, the contact-sheet layout, and,
 * with the real ffmpeg, the previews of an image and a video attached to a board.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ffmpegPath } from "@/lib/server/export/ffmpeg";
import { BridgeStateError, addBoardReferences, readReferenceFile, referenceFile, startBoard } from "..";
import { saveReference, sheetLayout } from "../references";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "motion-studio-refs-test-"));
  process.env.MOTION_STUDIO_BRIDGE_DIR = root;
});

afterAll(async () => {
  delete process.env.MOTION_STUDIO_BRIDGE_DIR;
  await rm(root, { recursive: true, force: true });
});

const BOARD = "0mh4c1z2kabcdef";

async function rejection(promise: Promise<unknown>): Promise<BridgeStateError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(BridgeStateError);
  return error as BridgeStateError;
}

describe("sheetLayout", () => {
  it("shows 12 frames, or 16 for clips over 20 seconds, centred in equal slots", () => {
    expect(sheetLayout(12)).toEqual({ columns: 4, rows: 3, times: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5] });
    const long = sheetLayout(32);
    expect([long.columns, long.rows, long.times.length]).toEqual([4, 4, 16]);
    expect(long.times[0]).toBe(1);
    expect(long.times[15]).toBe(31);
  });
});

describe("referenceFile", () => {
  it("only names a board's own reference files", () => {
    expect(referenceFile(BOARD, "r1.preview.jpg")).toBe(path.join(root, "refs", BOARD, "r1.preview.jpg"));
    expect(referenceFile(BOARD, "r2.mp4")).toBe(path.join(root, "refs", BOARD, "r2.mp4"));
    for (const name of ["../token", "r1.preview.jpg/..", "token", "r1.", "R1.mp4", "r123.mp4"]) expect(referenceFile(BOARD, name)).toBeNull();
    expect(() => referenceFile("../x", "r1.mp4")).toThrow(BridgeStateError);
  });
});

describe("saveReference", () => {
  it("refuses other file types and anything but a data: URL", async () => {
    expect((await rejection(saveReference(BOARD, 1, { name: "notes.pdf", dataUrl: "data:application/pdf;base64,AAAA" }))).status).toBe(400);
    expect((await rejection(saveReference(BOARD, 1, { name: "shot.png", dataUrl: "https://example.com/shot.png" }))).status).toBe(400);
  });

  it("answers 422 for a file ffmpeg cannot read, and leaves nothing behind", async () => {
    const error = await rejection(saveReference(BOARD, 1, { name: "broken.png", dataUrl: `data:image/png;base64,${Buffer.from("not a png").toString("base64")}` }));
    expect(error.status).toBe(422);
    expect(error.message).toContain('"broken.png" could not be read as an image');
    expect(existsSync(path.join(root, "refs", BOARD, "r1.png"))).toBe(false);
  });
});

const ffmpeg = ffmpegPath();
describe.skipIf(!existsSync(ffmpeg))("with the real ffmpeg", () => {
  let image: string;
  let video: string;

  beforeAll(async () => {
    const media = path.join(root, "media");
    execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=orange:s=1600x900", "-frames:v", "1", path.join(media + "-still.png")]);
    execFileSync(ffmpeg, [
      "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10", "-t", "3",
      "-pix_fmt", "yuv420p", path.join(media + "-clip.mp4"),
    ]);
    image = `data:image/png;base64,${(await readFile(media + "-still.png")).toString("base64")}`;
    video = `data:video/mp4;base64,${(await readFile(media + "-clip.mp4")).toString("base64")}`;
  }, 60_000);

  it("previews an image scaled down and a video as a contact sheet, numbered per board", async () => {
    const board = await startBoard({ brief: "A teaser for a café" });
    const updated = await addBoardReferences(board.id, [
      { name: "C:\\moodboard\\look.png", dataUrl: image },
      { name: "pacing.mp4", dataUrl: video },
    ]);
    expect(updated.references).toEqual([
      { id: "r1", name: "look.png", kind: "image", file: "r1.png", preview: "r1.preview.jpg" },
      expect.objectContaining({ id: "r2", name: "pacing.mp4", kind: "video", file: "r2.mp4", preview: "r2.preview.jpg", duration: 3 }),
    ]);
    expect(updated.references![1].frames).toHaveLength(12);

    const preview = await readReferenceFile(board.id, "r1.preview.jpg");
    expect(preview?.type).toBe("image/jpeg");
    expect([...preview!.bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    expect((await readReferenceFile(board.id, "r2.mp4"))?.type).toBe("video/mp4");
    expect(await readReferenceFile(board.id, "r9.preview.jpg")).toBeNull();

    const more = await addBoardReferences(board.id, [{ name: "second.png", dataUrl: image }]);
    expect(more.references!.map((ref) => ref.id)).toEqual(["r1", "r2", "r3"]);
    const full = await rejection(addBoardReferences(board.id, [{ name: "a.png", dataUrl: image }, { name: "b.png", dataUrl: image }]));
    expect(full.message).toBe("A storyboard takes at most 4 references");
  }, 60_000);
});

/** Real recorded sounds on the server: the trim filter and the cache (no download in tests). */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureRealSound, realSoundFile, soundTrimFilter } from "../audio";

describe("soundTrimFilter", () => {
  it("keeps the trim with short fades against clicks", () => {
    expect(soundTrimFilter([0.37, 2.55])).toBe(
      "atrim=start=0.37:end=2.55,asetpts=PTS-STARTPTS,afade=t=in:d=0.004,afade=t=out:st=2.150:d=0.030",
    );
  });

  it("leaves a seamless loop's edges alone", () => {
    expect(soundTrimFilter([0, 60], false)).toBe("atrim=start=0:end=60,asetpts=PTS-STARTPTS");
  });
});

describe("ensureRealSound", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "ms-sounds-"));
    process.env.MOTION_STUDIO_SOUNDS_DIR = dir;
  });

  afterEach(async () => {
    delete process.env.MOTION_STUDIO_SOUNDS_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  it("answers from the cache once a sound was downloaded", async () => {
    const cached = realSoundFile("pop");
    expect(path.dirname(cached)).toBe(dir);
    await writeFile(cached, "RIFF");
    await expect(ensureRealSound("pop")).resolves.toBe(cached);
  });

  it("refuses names outside the bank", async () => {
    await expect(ensureRealSound("../../secret")).rejects.toThrow('Unknown sound "../../secret"');
    await expect(ensureRealSound("whoosh")).rejects.toThrow("Unknown sound");
  });
});

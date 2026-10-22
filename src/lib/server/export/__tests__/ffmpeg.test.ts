import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { buildEncodeArgs, ffmpegPath, runFfmpeg } from "../ffmpeg";

const base = { fps: 30, width: 1280, height: 720, quality: 17, transparent: false } as const;
const input = ["-y", "-framerate", "30", "-i", "/job/frames/f_%06d.jpg"];

describe("buildEncodeArgs", () => {
  it("mp4: libx264 slow, crf, yuv420p, faststart", () => {
    expect(buildEncodeArgs("/job", { ...base, format: "mp4" })).toEqual({
      passes: [[...input, "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-r", "30", "/job/output.mp4"]],
      output: "/job/output.mp4",
      frameExt: "jpg",
    });
  });

  it("mp4: uses the requested CRF and crops odd dimensions to even", () => {
    const plan = buildEncodeArgs("/job", { ...base, format: "mp4", quality: 23, width: 1281, height: 720 });
    expect(plan.passes[0]).toEqual([
      ...input,
      "-vf", "crop=trunc(iw/2)*2:trunc(ih/2)*2:0:0",
      "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      "-r", "30", "/job/output.mp4",
    ]);
  });

  it("webm: vp9 with alpha when transparent (png frames), yuv420p otherwise", () => {
    expect(buildEncodeArgs("/job", { ...base, format: "webm", transparent: true })).toEqual({
      passes: [[
        "-y", "-framerate", "30", "-i", "/job/frames/f_%06d.png",
        "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "24", "-r", "30", "/job/output.webm",
      ]],
      output: "/job/output.webm",
      frameExt: "png",
    });
    expect(buildEncodeArgs("/job", { ...base, format: "webm" }).passes[0]).toEqual([
      ...input, "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-b:v", "0", "-crf", "24", "-r", "30", "/job/output.webm",
    ]);
  });

  it("mov: prores 4444 with 10-bit alpha when transparent", () => {
    expect(buildEncodeArgs("/job", { ...base, format: "mov", transparent: true }).passes).toEqual([[
      "-y", "-framerate", "30", "-i", "/job/frames/f_%06d.png",
      "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-r", "30", "/job/output.mov",
    ]]);
    expect(buildEncodeArgs("/job", { ...base, format: "mov" }).passes[0]).toContain("yuv444p10le");
  });

  it("gif: two passes, palettegen then paletteuse, scaled to the output width", () => {
    const plan = buildEncodeArgs("/job", { ...base, format: "gif", fps: 12, width: 640, height: 360 });
    const gifInput = ["-y", "-framerate", "12", "-i", "/job/frames/f_%06d.jpg"];
    expect(plan).toEqual({
      passes: [
        [...gifInput, "-vf", "fps=12,scale=640:-1:flags=lanczos,palettegen", "/job/palette.png"],
        [...gifInput, "-i", "/job/palette.png", "-lavfi", "fps=12,scale=640:-1:flags=lanczos[x];[x][1:v]paletteuse", "-r", "12", "/job/output.gif"],
      ],
      output: "/job/output.gif",
      frameExt: "jpg",
    });
  });

  it("gif and mp4 ignore the transparent flag (always opaque jpeg frames)", () => {
    expect(buildEncodeArgs("/job", { ...base, format: "gif", transparent: true }).frameExt).toBe("jpg");
    expect(buildEncodeArgs("/job", { ...base, format: "mp4", transparent: true }).passes[0]).toContain("yuv420p");
  });

  it("png-sequence: no ffmpeg passes, zip output, png frames", () => {
    expect(buildEncodeArgs("/job", { ...base, format: "png-sequence" })).toEqual({ passes: [], output: "/job/output.zip", frameExt: "png" });
  });
});

describe("runFfmpeg", () => {
  const originalPath = process.env.FFMPEG_PATH;
  afterEach(() => {
    if (originalPath === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = originalPath;
  });

  it("reads FFMPEG_PATH and defaults to ffmpeg on PATH", () => {
    delete process.env.FFMPEG_PATH;
    expect(ffmpegPath()).toBe("ffmpeg");
    process.env.FFMPEG_PATH = "/opt/bin/ffmpeg";
    expect(ffmpegPath()).toBe("/opt/bin/ffmpeg");
  });

  it("rejects with a clear message when the binary is missing", async () => {
    process.env.FFMPEG_PATH = "/nonexistent/ffmpeg-binary";
    await expect(runFfmpeg(["-version"])).rejects.toThrow(/Could not start ffmpeg/);
  });

  describe.skipIf(!existsSync("/usr/bin/ffmpeg"))("with the real binary", () => {
    it("surfaces the stderr tail on a non-zero exit", async () => {
      process.env.FFMPEG_PATH = "/usr/bin/ffmpeg";
      await expect(runFfmpeg(["-hide_banner", "-nonexistent-flag"])).rejects.toThrow(/ffmpeg exited with code \d+[\s\S]*Unrecognized option/);
    });

    it("kills a process that exceeds the timeout", async () => {
      process.env.FFMPEG_PATH = "/usr/bin/ffmpeg";
      const args = ["-hide_banner", "-re", "-f", "lavfi", "-i", "color=c=black:s=16x16:r=5", "-t", "30", "-f", "null", "-"];
      await expect(runFfmpeg(args, { timeoutMs: 300 })).rejects.toThrow(/timed out after 300ms/);
    });
  });
});

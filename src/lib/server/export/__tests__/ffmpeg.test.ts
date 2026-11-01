import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildEncodeArgs, ffmpegPath, runFfmpeg } from "../ffmpeg";
import path from "node:path";

const job = "/job";
/** Expectations go through path.join so they match the platform separator (backslashes on Windows). */
const frames = (ext: string) => path.join(job, "frames", `f_%06d.${ext}`);
const out = (name: string) => path.join(job, name);

const base = { fps: 30, width: 1280, height: 720, quality: 17, transparent: false } as const;
const input = ["-y", "-framerate", "30", "-i", frames("jpg")];
const bt709 = (pixFmt: string) => ["-vf", `scale=out_color_matrix=bt709:out_range=tv,format=${pixFmt}`];
const tags = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];

describe("buildEncodeArgs", () => {
  it("mp4: libx264 slow, crf, yuv420p converted and tagged as BT.709, faststart", () => {
    expect(buildEncodeArgs(job, { ...base, format: "mp4" })).toEqual({
      passes: [[
        ...input, ...bt709("yuv420p"),
        "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", ...tags, "-movflags", "+faststart",
        "-r", "30", out("output.mp4"),
      ]],
      output: out("output.mp4"),
      frameExt: "jpg",
    });
  });

  it("mp4: uses the requested CRF and crops odd dimensions to even", () => {
    const plan = buildEncodeArgs(job, { ...base, format: "mp4", quality: 23, width: 1281, height: 720 });
    expect(plan.passes[0]).toEqual([
      ...input,
      "-vf", "crop=trunc(iw/2)*2:trunc(ih/2)*2:0:0,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
      "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-pix_fmt", "yuv420p", ...tags, "-movflags", "+faststart",
      "-r", "30", out("output.mp4"),
    ]);
  });

  it("webm: vp9 with alpha when transparent (png frames), yuv420p otherwise", () => {
    expect(buildEncodeArgs(job, { ...base, format: "webm", transparent: true })).toEqual({
      passes: [[
        "-y", "-framerate", "30", "-i", frames("png"), ...bt709("yuva420p"),
        "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", ...tags, "-b:v", "0", "-crf", "24", "-r", "30", out("output.webm"),
      ]],
      output: out("output.webm"),
      frameExt: "png",
    });
    expect(buildEncodeArgs(job, { ...base, format: "webm" }).passes[0]).toEqual([
      ...input, ...bt709("yuv420p"),
      "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", ...tags, "-b:v", "0", "-crf", "24", "-r", "30", out("output.webm"),
    ]);
  });

  it("mov: prores 4444 with 10-bit alpha when transparent, never cropped", () => {
    expect(buildEncodeArgs(job, { ...base, format: "mov", transparent: true, width: 1281 }).passes).toEqual([[
      "-y", "-framerate", "30", "-i", frames("png"), ...bt709("yuva444p10le"),
      "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", ...tags, "-r", "30", out("output.mov"),
    ]]);
    expect(buildEncodeArgs(job, { ...base, format: "mov" }).passes[0]).toContain("yuv444p10le");
  });

  it("gif: two passes, palettegen then paletteuse, scaled to the output width", () => {
    const plan = buildEncodeArgs(job, { ...base, format: "gif", fps: 12, width: 640, height: 360 });
    const gifInput = ["-y", "-framerate", "12", "-i", frames("jpg")];
    expect(plan).toEqual({
      passes: [
        [...gifInput, "-vf", "fps=12,scale=640:-1:flags=lanczos,palettegen", out("palette.png")],
        [...gifInput, "-i", out("palette.png"), "-lavfi", "fps=12,scale=640:-1:flags=lanczos[x];[x][1:v]paletteuse", "-r", "12", out("output.gif")],
      ],
      output: out("output.gif"),
      frameExt: "jpg",
    });
  });

  it("gif and mp4 ignore the transparent flag (always opaque jpeg frames)", () => {
    expect(buildEncodeArgs(job, { ...base, format: "gif", transparent: true }).frameExt).toBe("jpg");
    expect(buildEncodeArgs(job, { ...base, format: "mp4", transparent: true }).passes[0]).toContain("yuv420p");
  });

  it("png-sequence: no ffmpeg passes, zip output, png frames", () => {
    expect(buildEncodeArgs(job, { ...base, format: "png-sequence" })).toEqual({ passes: [], output: out("output.zip"), frameExt: "png" });
  });
});

describe.skipIf(ffmpegPath() === "ffmpeg")("mp4 colour with the bundled ffmpeg", () => {
  it("decodes back to the frame's colour the way a BT.709 player reads it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "motion-colour-"));
    try {
      await mkdir(path.join(dir, "frames"));
      await runFfmpeg(["-v", "error", "-f", "lavfi", "-i", "color=c=0x22C55E:s=64x64:d=0.1:r=30", "-q:v", "2", path.join(dir, "frames", "f_%06d.jpg")]);
      for (const pass of buildEncodeArgs(dir, { ...base, format: "mp4", width: 64, height: 64 }).passes) await runFfmpeg(pass);
      const pixel = path.join(dir, "pixel.rgb");
      await runFfmpeg([
        "-v", "error", "-i", path.join(dir, "output.mp4"), "-frames:v", "1",
        "-vf", "scale=in_color_matrix=bt709:in_range=tv,format=rgb24,crop=1:1:32:32", "-f", "rawvideo", pixel,
      ]);
      const [r, g, b] = await readFile(pixel);
      // Before the BT.709 conversion this came back as about #16AF5C (green off by 22).
      expect(Math.max(Math.abs(r - 0x22), Math.abs(g - 0xc5), Math.abs(b - 0x5e))).toBeLessThanOrEqual(6);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("runFfmpeg", () => {
  const originalPath = process.env.FFMPEG_PATH;
  afterEach(() => {
    if (originalPath === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = originalPath;
  });

  it("reads FFMPEG_PATH, else the bundled ffmpeg-static binary, else ffmpeg on PATH", () => {
    delete process.env.FFMPEG_PATH;
    const resolved = ffmpegPath();
    // ffmpeg-static downloads its binary at install time; when pnpm blocked that
    // script the resolver must still fall back to "ffmpeg" on PATH.
    expect(resolved === "ffmpeg" || (resolved.includes("ffmpeg-static") && existsSync(resolved))).toBe(true);
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

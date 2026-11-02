import { describe, expect, it } from "vitest";
import { buildIngestArgs, frameRateFor, frameSide, jpegSize, parseProbe } from "../ingest";
import { parseRange } from "../range";

// ffmpeg -hide_banner -i talk.mp4 (a 4K vertical camera file)
const CAMERA = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'D:\\Footage\\talk.mp4':
  Metadata:
    major_brand     : mp42
  Duration: 00:00:46.35, start: 0.000000, bitrate: 60237 kb/s
  Stream #0:0[0x1](eng): Video: h264 (Main) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 2160x3840, 59912 kb/s, 29.97 fps, 29.97 tbr, 30k tbn (default)
    Metadata:
      handler_name    : ?Mainconcept Video Media Handler
  Stream #0:1[0x2](eng): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 317 kb/s (default)
At least one output file must be specified`;

// A phone clip stored landscape with a -90° display matrix, and no sound track.
const PHONE = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'IMG_0042.MOV':
  Duration: 00:01:02.50, start: 0.000000, bitrate: 12000 kb/s
  Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv, bt709), 1920x1080, 11800 kb/s, 59.94 fps, 59.94 tbr, 600 tbn (default)
    Side data:
      displaymatrix: rotation of -90.00 degrees
At least one output file must be specified`;

describe("parseProbe", () => {
  it("reads length, size, frame rate and sound from ffmpeg's banner", () => {
    expect(parseProbe(CAMERA)).toEqual({ duration: 46.35, fps: 29.97, width: 2160, height: 3840, rotation: 0, hasVideo: true, hasAudio: true });
  });

  it("reads the rotation of phone footage and a missing sound track", () => {
    expect(parseProbe(PHONE)).toMatchObject({ duration: 62.5, fps: 59.94, width: 1920, height: 1080, rotation: -90, hasAudio: false });
  });

  it("reports a file without video", () => {
    expect(parseProbe("Input #0, wav, from 'a.wav':\n  Duration: 00:00:03.00\n  Stream #0:0: Audio: pcm_s16le")).toMatchObject({ hasVideo: false, hasAudio: true });
  });
});

describe("frames", () => {
  it("indexes frames at the source rate, rounded to a whole number between 1 and 60", () => {
    expect(frameRateFor(29.97)).toBe(30);
    expect(frameRateFor(23.976)).toBe(24);
    expect(frameRateFor(119.88)).toBe(60);
    expect(frameRateFor(0)).toBe(30);
  });

  it("keeps frames at 2560 px on the long side unless configured", () => {
    expect(frameSide({})).toBe(2560);
    expect(frameSide({ MOTION_STUDIO_MEDIA_FRAME_SIDE: "3840" })).toBe(3840);
    expect(frameSide({ MOTION_STUDIO_MEDIA_FRAME_SIDE: "12" })).toBe(2560);
  });

  it("writes the preview copy and the frames in one ffmpeg run, at the same rate", () => {
    const args = buildIngestArgs("in.mp4", "preview.mp4", "frames/f_%06d.jpg", 30, 2560);
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("fps=30,split=2");
    expect(graph).toContain("min(1920,iw)");
    expect(graph).toContain("min(2560,ih)");
    expect(args).toContain("0:a:0?");
    expect(args.slice(-1)[0]).toBe("frames/f_%06d.jpg");
    expect(args).toContain("preview.mp4");
  });

  it("reads a JPEG's size from its frame header", () => {
    const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0)];
    const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x0a, 0x00, 0x05, 0xa0, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
    expect(jpegSize(new Uint8Array([0xff, 0xd8, ...app0, ...sof0]))).toEqual({ width: 1440, height: 2560 });
    expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});

describe("parseRange", () => {
  it("handles the forms browsers send when seeking a video", () => {
    expect(parseRange("bytes=0-", 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange("bytes=100-199", 1000)).toEqual({ start: 100, end: 199 });
    expect(parseRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
  });

  it("rejects ranges it cannot serve", () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange("bytes=2000-", 1000)).toBeNull();
    expect(parseRange("bytes=5-1", 1000)).toBeNull();
    expect(parseRange("bytes=0-1,5-9", 1000)).toBeNull();
  });
});

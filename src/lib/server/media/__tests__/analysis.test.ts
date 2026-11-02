import { describe, expect, it } from "vitest";
import { dominantColors, parseCuts, parseLoudness, pickStripCuts, sheetPlan, shotsBetween } from "../analysis";
import { checkLink, ytDlpArgs } from "../download";

// select='gt(scene,0.3)',showinfo on stderr (trimmed)
const SHOWINFO = `[Parsed_showinfo_2 @ 0x1] n:   0 pts:  14500 pts_time:1.20833 duration:500 pos:12345 fmt:yuv420p
[Parsed_showinfo_2 @ 0x1] n:   1 pts:  15500 pts_time:1.29167 duration:500
[Parsed_showinfo_2 @ 0x1] n:   2 pts:  15550 pts_time:1.29583 duration:500
[Parsed_showinfo_2 @ 0x1] n:   3 pts:  40000 pts_time:3.33333 duration:500
[Parsed_showinfo_2 @ 0x1] n:   4 pts:    100 pts_time:0.01 duration:500`;

// ebur128=peak=true: the summary at the end
const EBUR128 = `[Parsed_ebur128_0 @ 0x1] t: 41.9  TARGET:-23 LUFS    M: -12.0 S: -13.1     I: -14.2 LUFS       LRA:   5.1 LU  FTPK: -0.5 dBFS  TPK:  0.2 dBFS
[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:         -14.1 LUFS
    Threshold: -24.3 LUFS

  Loudness range:
    LRA:         5.0 LU

  True peak:
    Peak:        0.2 dBFS`;

describe("reading ffmpeg's measurements", () => {
  it("collects cut times, merging detections a few hundredths apart", () => {
    expect(parseCuts(SHOWINFO)).toEqual([1.208, 1.292, 3.333]);
  });

  it("reads the summary's integrated loudness and true peak", () => {
    expect(parseLoudness(EBUR128)).toEqual({ integrated: -14.1, peak: 0.2 });
    expect(parseLoudness("no summary")).toBeNull();
  });
});

describe("planning what Claude sees", () => {
  it("cuts the video into shots, dropping slivers", () => {
    expect(shotsBetween([1.2, 1.25, 3], 5)).toEqual([
      { start: 0, end: 1.2 },
      { start: 1.25, end: 3 },
      { start: 3, end: 5 },
    ]);
  });

  it("spreads the transition strips over the whole video", () => {
    expect(pickStripCuts([1, 2, 3], 6)).toEqual([1, 2, 3]);
    expect(pickStripCuts([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 6)).toEqual([1, 3, 5, 7, 9, 11]);
  });

  it("shapes contact sheets like the video and fits a whole reel into at most 12 of them", () => {
    const reel = sheetPlan(42.1, 1080, 1920);
    expect(reel).toMatchObject({ columns: 6, rows: 3, tileHeight: 300, tileWidth: 168 });
    expect(reel.sheets).toBeLessThanOrEqual(12);
    expect(reel.fps).toBeLessThanOrEqual(8);
    const wide = sheetPlan(10, 1920, 1080);
    expect(wide).toMatchObject({ columns: 3, rows: 6, tileWidth: 300, fps: 8 });
    expect(sheetPlan(600, 1080, 1080).sheets).toBe(12);
  });

  it("finds an image's main colours and brightness", () => {
    const pixels = new Uint8Array(16 * 16 * 3);
    for (let i = 0; i < 256; i++) pixels.set(i < 192 ? [250, 90, 54] : [10, 10, 12], i * 3);
    const { colors, brightness } = dominantColors(pixels, 2);
    expect(colors).toEqual(["#fa5a36", "#0a0a0c"]);
    expect(brightness).toBeGreaterThan(0.3);
    expect(brightness).toBeLessThan(0.4);
  });
});

describe("references from a link", () => {
  it("accepts public http(s) links only", () => {
    expect(checkLink("https://www.instagram.com/reel/DfFdFLLTmxr/")).toBeInstanceOf(URL);
    expect(checkLink("http://127.0.0.1:3000/api/bridge/status")).toMatch(/this computer/);
    expect(checkLink("http://localhost/x")).toMatch(/this computer/);
    expect(checkLink("http://192.168.1.10/video.mp4")).toMatch(/local network/);
    expect(checkLink("http://[::1]/x")).toMatch(/this computer/);
    expect(checkLink("file:///C:/Windows/win.ini")).toMatch(/http and https/);
    expect(checkLink("https://user:pass@example.com/v")).toMatch(/user name/);
    expect(checkLink("not a link")).toMatch(/not a link/);
  });

  it("runs yt-dlp without config, cookies or playlists, into the file's own folder", () => {
    const args = ytDlpArgs("https://www.instagram.com/reel/x/", "/media/abc", "/bin/ffmpeg");
    expect(args).toEqual(expect.arrayContaining(["--ignore-config", "--no-playlist", "--no-cookies", "--ffmpeg-location", "/bin/ffmpeg"]));
    expect(args[args.indexOf("-S") + 1]).toBe("res:1080,ext:mp4:m4a");
    expect(args[args.indexOf("-o") + 1].replace(/\\/g, "/")).toBe("/media/abc/download.%(ext)s");
    // The link comes last, after "--", so it can never be read as an option.
    expect(args.slice(-2)).toEqual(["--", "https://www.instagram.com/reel/x/"]);
  });
});

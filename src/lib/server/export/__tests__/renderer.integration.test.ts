/**
 * End-to-end: real Chromium renders a tiny static page that implements the
 * runtime globals, then real ffmpeg encodes mp4 + gif (opaque jpeg frames)
 * and webm (transparent png frames); png-sequence zips the png frames.
 * Skipped when the box-level Chromium or ffmpeg is missing.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encode } from "../ffmpeg";
import { createJob, readStatus } from "../jobs";
import { renderJob } from "../renderer";
import { makeRequest } from "./fixtures";

const CHROMIUM = "/opt/pw-browsers/chromium";
const FFMPEG = "/usr/bin/ffmpeg";
const FFPROBE = "/usr/bin/ffprobe";
const canRun = existsSync(CHROMIUM) && existsSync(FFMPEG) && existsSync(FFPROBE);

/** 320x180, 1s, 10fps: an orange box whose left offset is t*100px. `?transparent=1` drops the page background. */
const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:320px;height:180px;overflow:hidden;background:#102030}
#box{position:absolute;top:60px;width:60px;height:60px;background:#f80}
</style></head><body><div id="box"></div><script>
if (location.search.includes("transparent=1")) { document.documentElement.style.background = "transparent"; document.body.style.background = "transparent"; }
window.__videoMeta = { width: 320, height: 180, duration: 1, fps: 10 };
window.__seek = function (t) { document.getElementById("box").style.left = (t * 100) + "px"; };
window.__ready = true;
</script></body></html>`;

interface Probe {
  width: number;
  height: number;
  frames: number;
  alphaMode?: string;
}

function ffprobe(file: string): Promise<Probe> {
  const args = [
    "-v", "error", "-count_frames", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,nb_read_frames:stream_tags=alpha_mode", "-of", "json", file,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(FFPROBE, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.stderr.on("data", (c: Buffer) => (err += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}: ${err}`));
      const stream = JSON.parse(out).streams[0];
      resolve({
        width: Number(stream.width),
        height: Number(stream.height),
        frames: Number(stream.nb_read_frames),
        alphaMode: stream.tags?.alpha_mode ?? stream.tags?.ALPHA_MODE,
      });
    });
  });
}

describe.skipIf(!canRun)("renderer + ffmpeg integration", () => {
  let root: string;
  let server: http.Server;
  let pageUrl: string;
  const savedEnv = { jobs: process.env.MOTION_STUDIO_JOBS_DIR, chromium: process.env.CHROMIUM_PATH, ffmpeg: process.env.FFMPEG_PATH };

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "motion-studio-render-test-"));
    process.env.MOTION_STUDIO_JOBS_DIR = root;
    process.env.CHROMIUM_PATH = CHROMIUM;
    process.env.FFMPEG_PATH = FFMPEG;
    const pagePath = path.join(root, "page.html");
    await writeFile(pagePath, PAGE_HTML, "utf8");
    server = http.createServer(async (req, res) => {
      if (!req.url?.startsWith("/page.html")) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(await readFile(pagePath));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    pageUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/page.html`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [key, value] of [["MOTION_STUDIO_JOBS_DIR", savedEnv.jobs], ["CHROMIUM_PATH", savedEnv.chromium], ["FFMPEG_PATH", savedEnv.ffmpeg]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  });

  const meta = { width: 320, height: 180, duration: 1, fps: 10 };

  it("renders 10 jpeg frames with 2 workers and encodes mp4 + gif", { timeout: 60_000 }, async () => {
    const { jobId, dir } = await createJob(makeRequest({ format: "mp4" }, { meta }));
    const { plan, framesDir } = await renderJob(jobId, "http://unused.invalid", { workers: 2, pageUrl });

    expect(plan.frameCount).toBe(10);
    expect(plan.frameExt).toBe("jpg");
    const frames = (await readdir(framesDir)).sort();
    expect(frames).toEqual(Array.from({ length: 10 }, (_, i) => `f_${String(i).padStart(6, "0")}.jpg`));
    for (const frame of frames) expect((await stat(path.join(framesDir, frame))).size).toBeGreaterThan(1000);
    // frames differ (the box moved): first and last are not byte-identical
    expect(Buffer.compare(await readFile(path.join(framesDir, frames[0])), await readFile(path.join(framesDir, frames[9])))).not.toBe(0);
    expect(await readStatus(jobId)).toMatchObject({ state: "rendering", framesDone: 10, framesTotal: 10, progress: 1 });

    const encodeOpts = { fps: plan.fps, transparent: false, quality: plan.quality, width: plan.outputWidth, height: plan.outputHeight };
    const mp4 = await encode(dir, { ...encodeOpts, format: "mp4" });
    expect(mp4).toBe(path.join(dir, "output.mp4"));
    expect((await stat(mp4)).size).toBeGreaterThan(1024);
    expect(await ffprobe(mp4)).toMatchObject({ width: 320, height: 180, frames: 10 });

    const gif = await encode(dir, { ...encodeOpts, format: "gif" });
    expect((await stat(gif)).size).toBeGreaterThan(1024);
    expect(await ffprobe(gif)).toMatchObject({ width: 320, height: 180, frames: 10 });
  });

  it("renders transparent png frames and encodes webm with alpha + a png-sequence zip", { timeout: 60_000 }, async () => {
    const { jobId, dir } = await createJob(makeRequest({ format: "webm", transparent: true }, { meta }));
    const { plan, framesDir } = await renderJob(jobId, "http://unused.invalid", { workers: 3, pageUrl: `${pageUrl}?transparent=1` });
    expect(plan.transparent).toBe(true);
    expect(plan.frameExt).toBe("png");
    expect((await readdir(framesDir)).filter((f) => f.endsWith(".png"))).toHaveLength(10);
    // PNG IHDR colour type 6 = RGBA: the screenshot really carries an alpha channel
    expect((await readFile(path.join(framesDir, "f_000000.png")))[25]).toBe(6);

    const encodeOpts = { fps: plan.fps, transparent: true, quality: plan.quality, width: plan.outputWidth, height: plan.outputHeight };
    const webm = await encode(dir, { ...encodeOpts, format: "webm" });
    expect((await stat(webm)).size).toBeGreaterThan(1024);
    const probe = await ffprobe(webm);
    expect(probe).toMatchObject({ width: 320, height: 180, frames: 10 });
    expect(probe.alphaMode).toBe("1");

    const zipPath = await encode(dir, { ...encodeOpts, format: "png-sequence" });
    expect((await stat(zipPath)).size).toBeGreaterThan(1024);
    const zip = await JSZip.loadAsync(await readFile(zipPath));
    expect(Object.keys(zip.files).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `f_${String(i).padStart(6, "0")}.png`));
  });
});

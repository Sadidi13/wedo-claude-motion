/**
 * End-to-end WebGL export: real Chromium renders a three.js page (served from
 * the pinned `three` package) that implements the runtime globals the way
 * <Three3D> does — draw synchronously inside `__seek`, `preserveDrawingBuffer`,
 * and a texture that decodes late, holding the frame through `__whenIdle` —
 * then real ffmpeg encodes an mp4. Checks: frames are drawn (not blank), the
 * late texture is on the frame it belongs to, alpha survives, identical pixels
 * across worker counts, and the forced-SwiftShader mode renders too.
 *
 * Runs wherever a Chrome / Chromium / Edge and ffmpeg resolve (Windows and
 * macOS desktops). Skipped on CI unless MOTION_STUDIO_WEBGL_TEST=1: hosted
 * runners have no GPU and their Chrome sandbox setup is not verified here.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encode, ffmpegPath } from "../ffmpeg";
import { createJob } from "../jobs";
import { renderJob, resolveChromiumPath } from "../renderer";
import { makeRequest } from "./fixtures";

const THREE_BUILD = path.join(process.cwd(), "node_modules", "three", "build");
const CHROMIUM = resolveChromiumPath();
const FFMPEG = ffmpegPath();
const canRun =
  Boolean(CHROMIUM) &&
  existsSync(path.join(THREE_BUILD, "three.module.js")) &&
  (FFMPEG === "ffmpeg" || existsSync(FFMPEG)) &&
  (!process.env.CI || process.env.MOTION_STUDIO_WEBGL_TEST === "1");

/**
 * 320x180, 1 s, 10 fps. An orange box flies left → right and spins. From t = 0.5 it wears a
 * green texture that takes 300 ms to arrive the first time: the frame is held meanwhile.
 * `?transparent=1` drops the page background (the canvas itself is transparent: alpha: true).
 */
const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:320px;height:180px;overflow:hidden;background:#102030}
canvas{position:absolute;left:0;top:0;width:320px;height:180px}
</style></head><body><canvas id="c"></canvas><script type="module">
import * as THREE from "/_next/static/three/three.module.js";
if (location.search.includes("transparent=1")) {
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
}
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("c"), alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(320, 180, false);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 320 / 180, 0.1, 100);
camera.position.set(0, 0, 5);
scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.5));
const key = new THREE.DirectionalLight(0xffffff, 2);
key.position.set(3, 4, 5);
scene.add(key);
const material = new THREE.MeshStandardMaterial({ color: 0xff7733 });
const box = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), material);
scene.add(box);

let texture = null;
let loading = null;
let holds = 0;
let waiters = [];
window.__whenIdle = () => (holds === 0 ? Promise.resolve() : new Promise((resolve) => waiters.push(resolve)));
let current = 0;

function draw(t) {
  const textured = t >= 0.5 && texture !== null;
  if ((material.map !== null) !== textured) {
    material.map = textured ? texture : null;
    material.color.set(textured ? 0xffffff : 0xff7733);
    material.needsUpdate = true;
  }
  box.rotation.set(t * 1.3, t * 2.1, 0);
  box.position.x = -2 + t * 4;
  renderer.render(scene, camera);
}

function loadTexture() {
  holds += 1;
  const pixels = new Uint8Array([40, 220, 60, 255, 40, 220, 60, 255, 40, 220, 60, 255, 40, 220, 60, 255]);
  return new Promise((resolve) => setTimeout(resolve, 300)).then(() => {
    texture = new THREE.DataTexture(pixels, 2, 2);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    draw(current);
    holds -= 1;
    if (holds === 0) { const done = waiters; waiters = []; done.forEach((resolve) => resolve()); }
  });
}

window.__videoMeta = { width: 320, height: 180, duration: 1, fps: 10 };
window.__seek = (t) => {
  current = t;
  if (t >= 0.5 && texture === null && loading === null) loading = loadTexture();
  draw(t);
};
window.__ready = true;
</script></body></html>`;

function run(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${cmd} exited ${code}: ${err}`))));
  });
}

/** Decoded pixels of an image (or the first frame of a video) as raw rgb24 / rgba bytes. */
function pixels(file: string, format: "rgb24" | "rgba"): Promise<Buffer> {
  return run(FFMPEG, ["-v", "error", "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", format, "-"]);
}

/** Pixel counts by colour: the untextured orange box, the textured green box. */
function census(rgb: Buffer): { orange: number; green: number } {
  let orange = 0;
  let green = 0;
  for (let i = 0; i < rgb.length; i += 3) {
    const [r, g, b] = [rgb[i], rgb[i + 1], rgb[i + 2]];
    if (r > 150 && g < 170 && b < 120 && r > g + 40) orange += 1;
    if (g > 110 && r < 100 && g > r + 50) green += 1;
  }
  return { orange, green };
}

describe.skipIf(!canRun)("WebGL export (three.js page + renderer + ffmpeg)", () => {
  let root: string;
  let server: http.Server;
  let pageUrl: string;
  const savedEnv = { jobs: process.env.MOTION_STUDIO_JOBS_DIR, webgl: process.env.MOTION_STUDIO_WEBGL };
  // The fixture scene imports three, so renderJob launches Chromium with the WebGL switches.
  const project = {
    meta: { width: 320, height: 180, duration: 1, fps: 10 },
    files: {
      "scene.jsx": {
        path: "scene.jsx",
        kind: "jsx" as const,
        content: 'import * as THREE from "three";\nexport default function Scene() { return null; }',
      },
    },
  };

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "motion-studio-webgl-test-"));
    process.env.MOTION_STUDIO_JOBS_DIR = root;
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/page.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE_HTML);
        return;
      }
      // Served where the app's own bundles live: the export request policy only lets /_next/* load.
      const match = /^\/_next\/static\/three\/([\w.-]+\.js)$/.exec(url.pathname);
      if (match && existsSync(path.join(THREE_BUILD, match[1]))) {
        res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" }).end(await readFile(path.join(THREE_BUILD, match[1])));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    pageUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/page.html`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [key, value] of [["MOTION_STUDIO_JOBS_DIR", savedEnv.jobs], ["MOTION_STUDIO_WEBGL", savedEnv.webgl]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  });

  async function renderFrames(workers: number, transparent = false) {
    const options = transparent ? { format: "png-sequence" as const, transparent: true } : { format: "mp4" as const };
    const job = await createJob(makeRequest(options, project));
    const url = transparent ? `${pageUrl}?transparent=1` : pageUrl;
    const result = await renderJob(job.jobId, "http://unused.invalid", { workers, pageUrl: url });
    const frames = (await readdir(result.framesDir)).sort().map((name) => path.join(result.framesDir, name));
    return { ...job, ...result, frames };
  }

  it("draws every frame, waits for the late texture, and encodes an mp4", { timeout: 120_000 }, async () => {
    const { dir, plan, frames } = await renderFrames(2);
    expect(frames).toHaveLength(10);

    const counts = await Promise.all(frames.map(async (frame) => census(await pixels(frame, "rgb24"))));
    for (const [index, { orange, green }] of counts.entries()) {
      if (index < 5) {
        expect(orange, `frame ${index} shows the orange box`).toBeGreaterThan(400);
        expect(green, `frame ${index} has no texture yet`).toBe(0);
      } else {
        // the texture arrived 300 ms after the first seek past 0.5 s; the frame was held for it
        expect(green, `frame ${index} shows the textured box`).toBeGreaterThan(400);
        expect(orange, `frame ${index} lost the orange colour`).toBeLessThan(20);
      }
    }
    // the box moves: first and last frames differ
    expect(Buffer.compare(await readFile(frames[0]), await readFile(frames[9]))).not.toBe(0);

    const mp4 = await encode(dir, {
      format: "mp4",
      fps: plan.fps,
      transparent: false,
      quality: plan.quality,
      width: plan.outputWidth,
      height: plan.outputHeight,
    });
    expect((await stat(mp4)).size).toBeGreaterThan(1024);
    expect(census(await pixels(mp4, "rgb24")).orange).toBeGreaterThan(300);
  });

  it("renders identical pixels whatever the worker split", { timeout: 120_000 }, async () => {
    const one = await renderFrames(1);
    const three = await renderFrames(3);
    for (const [index, frame] of one.frames.entries()) {
      const [a, b] = await Promise.all([pixels(frame, "rgb24"), pixels(three.frames[index], "rgb24")]);
      expect(a.equals(b), `frame ${index} is identical`).toBe(true);
    }
  });

  it("keeps the canvas transparent where nothing is drawn (alpha export)", { timeout: 120_000 }, async () => {
    const { frames } = await renderFrames(2, true);
    const rgba = await pixels(frames[0], "rgba");
    let clear = 0;
    let solid = 0;
    for (let i = 3; i < rgba.length; i += 4) {
      if (rgba[i] === 0) clear += 1;
      else if (rgba[i] === 255) solid += 1;
    }
    expect(clear).toBeGreaterThan(320 * 180 * 0.8);
    expect(solid).toBeGreaterThan(400);
  });

  it("renders with the software rasteriser when MOTION_STUDIO_WEBGL=swiftshader", { timeout: 120_000 }, async () => {
    process.env.MOTION_STUDIO_WEBGL = "swiftshader";
    try {
      const { frames } = await renderFrames(2);
      expect(census(await pixels(frames[0], "rgb24")).orange).toBeGreaterThan(400);
      expect(census(await pixels(frames[9], "rgb24")).green).toBeGreaterThan(400);
    } finally {
      delete process.env.MOTION_STUDIO_WEBGL;
    }
  });
});

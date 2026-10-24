/**
 * Headless frame renderer (CONTRACTS.md §6).
 *
 * Opens `${origin}/preview?job=<id>&__render=1[&transparent=1]` in Chromium
 * (playwright-core), waits for the runtime globals, then drives
 * `window.__seek(t)` frame by frame and screenshots the stage clip into
 * `<jobDir>/frames/f_%06d.(png|jpg)`. After each seek it awaits
 * `window.__whenIdle()` (pending <Three3D> textures) and two animation frames,
 * so WebGL canvases — drawn synchronously inside `__seek` with
 * preserveDrawingBuffer — are on screen. Projects that draw with WebGL get the
 * extra Chromium switches of `webglLaunchArgs`. Frames are split into
 * contiguous ranges, one BrowserContext + page per worker. status.json is
 * updated every 10 frames and on completion; the browser is always closed in
 * `finally`. Each worker also reports the <Audio> clips its frames rendered
 * (`window.__getAudioClips`), merged into `RenderResult.audio` for the mix.
 *
 * Tests pass `pageUrl` to render any page that implements the same globals.
 */

import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";
import type { Project } from "@/lib/types";
import { type AudioClip, mergeClips } from "./audio";
import { jobDir, readOptions, readProject, writeStatus } from "./jobs";
import { frameFileName, frameTime, partitionFrames, resolvePlan, type FrameRange, type RenderPlan } from "./plan";

export interface RenderOptions {
  /** parallel browser contexts (default: defaultWorkers(), capped at the frame count) */
  workers?: number;
  /** full page URL to render instead of `${origin}/preview?job=…` (tests) */
  pageUrl?: string;
}

export interface RenderResult {
  plan: RenderPlan;
  framesDir: string;
  /** the <Audio> clips the scene rendered (empty when it has none) */
  audio: AudioClip[];
}

/** Minimal view of the globals the runtime installs (see src/runtime/globals.ts). */
interface PreviewGlobals {
  __ready?: boolean;
  __seek?: (time: number) => void;
  __videoMeta?: unknown;
  __whenIdle?: () => Promise<void>;
}

/** Parallel pages when the machine's core count is unknown. */
export const DEFAULT_WORKERS = 3;
const MAX_WORKERS = 8;

/**
 * Pages rendering in parallel: half the logical cores (each page has its own renderer and GPU
 * work), between 2 and 8; MOTION_STUDIO_EXPORT_WORKERS overrides it.
 */
export function defaultWorkers(env: Record<string, string | undefined> = process.env, cores = os.availableParallelism?.() ?? 0): number {
  const forced = Number(env.MOTION_STUDIO_EXPORT_WORKERS);
  if (Number.isInteger(forced) && forced >= 1) return Math.min(forced, 16);
  if (!cores) return DEFAULT_WORKERS;
  return Math.min(MAX_WORKERS, Math.max(2, Math.floor(cores / 2)));
}
const FALLBACK_CHROMIUM = "/opt/pw-browsers/chromium";
const READY_TIMEOUT_MS = 60_000;
const NAVIGATION_TIMEOUT_MS = 90_000;
const SEEK_TIMEOUT_MS = 15_000;
const FONT_SETTLE_MS = 300;
const STATUS_EVERY_FRAMES = 10;
export const CHROMIUM_LAUNCH_ARGS = ["--disable-dev-shm-usage", "--force-color-profile=srgb"];

/** Scene code that draws with WebGL: the runtime's <Three3D>, a `three` import, or a raw WebGL context. */
const WEBGL_SOURCE =
  /\bThree3D\b|\bfrom\s*["']three["']|\brequire\(\s*["']three["']\s*\)|getContext\(\s*["'](?:webgl2?|experimental-webgl)["']/;
const SCRIPT_KINDS: ReadonlySet<string> = new Set(["jsx", "js", "tsx", "ts", "html"]);

export function projectUsesWebGL(project: Pick<Project, "files">): boolean {
  return Object.values(project.files).some((file) => SCRIPT_KINDS.has(file.kind) && WEBGL_SOURCE.test(file.content));
}

/**
 * How export draws WebGL. "gpu" (default): the machine's GPU, which headless Chrome uses when
 * it has one (Windows: ANGLE on Direct3D 11), falling back to SwiftShader on machines without
 * one (CI, VMs, remote desktops). "swiftshader" (MOTION_STUDIO_WEBGL=swiftshader): always the
 * software renderer — slower, but the same pixels on every machine and immune to driver bugs.
 */
export type WebGLMode = "gpu" | "swiftshader";

export function webglMode(env: Record<string, string | undefined> = process.env): WebGLMode {
  return env.MOTION_STUDIO_WEBGL === "swiftshader" ? "swiftshader" : "gpu";
}

/**
 * Chromium only runs WebGL on SwiftShader with --enable-unsafe-swiftshader ("unsafe": its JIT
 * is attack surface for web content). It is added for 3D projects only, and the sandbox
 * stays on (see chromiumSandboxEnabled).
 */
export function webglLaunchArgs(mode: WebGLMode): string[] {
  return mode === "swiftshader" ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : ["--enable-unsafe-swiftshader"];
}

/** The Chromium switches for one export: the base set, plus the WebGL ones when the scene needs them. */
export function chromiumLaunchArgs(webgl: boolean, env: Record<string, string | undefined> = process.env): string[] {
  return webgl ? [...CHROMIUM_LAUNCH_ARGS, ...webglLaunchArgs(webglMode(env))] : [...CHROMIUM_LAUNCH_ARGS];
}

/**
 * Whether export runs Chromium with its sandbox. The pages it renders run imported (untrusted)
 * scene code, so the sandbox stays on (playwright-core adds --no-sandbox unless told
 * `chromiumSandbox: true`). It is only switched off where Chromium cannot start with it: as root on
 * Linux (containers), or explicitly with MOTION_STUDIO_CHROMIUM_NO_SANDBOX=1.
 */
export function chromiumSandboxEnabled(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  uid: number | undefined = process.getuid?.(),
): boolean {
  return !(env.MOTION_STUDIO_CHROMIUM_NO_SANDBOX === "1" || (platform === "linux" && uid === 0));
}

/**
 * Network policy while rendering untrusted scene code: on the app's own origin only the page
 * itself, the app's bundles (/_next/*) and this job's project may load, so the scene cannot call
 * /api (start more exports, queue work for Claude, read projects). Other origins (web fonts,
 * images) stay allowed so exports look like the editor.
 */
export function isAllowedRenderRequest(requestUrl: string, pageUrl: string, jobId: string): boolean {
  let request: URL;
  let page: URL;
  try {
    request = new URL(requestUrl);
    page = new URL(pageUrl);
  } catch {
    return false;
  }
  if (request.protocol === "data:" || request.protocol === "blob:") return true;
  if (request.origin !== page.origin) return true;
  return (
    request.pathname === page.pathname ||
    request.pathname.startsWith("/_next/") ||
    request.pathname === `/api/export/${jobId}/project`
  );
}

/** CHROMIUM_PATH, else the box-level Chromium, else whatever playwright-core resolves itself. */
/** Well-known Chrome / Chromium / Edge locations, probed when CHROMIUM_PATH is not set. */
function knownBrowserPaths(): string[] {
  const env = process.env;
  if (process.platform === "win32") {
    const roots = [env["PROGRAMFILES"], env["PROGRAMFILES(X86)"], env["LOCALAPPDATA"]].filter((r): r is string => !!r);
    return roots.flatMap((root) => [
      `${root}\\Google\\Chrome\\Application\\chrome.exe`,
      `${root}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${root}\\Chromium\\Application\\chrome.exe`,
    ]);
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
  }
  return [
    FALLBACK_CHROMIUM,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
}

/**
 * CHROMIUM_PATH wins; otherwise the first installed browser from the known
 * locations; otherwise undefined so playwright-core uses its own download.
 */
export function resolveChromiumPath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  return knownBrowserPaths().find((candidate) => existsSync(candidate));
}

export function previewUrl(origin: string, jobId: string, transparent: boolean): string {
  const url = new URL("/preview", origin);
  url.searchParams.set("job", jobId);
  url.searchParams.set("__render", "1");
  if (transparent) url.searchParams.set("transparent", "1");
  return url.toString();
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Shared frame counter; writes status.json every 10 frames and on the last frame. */
function createProgress(jobId: string, total: number) {
  let done = 0;
  let written = 0;
  return async () => {
    done += 1;
    if (done - written < STATUS_EVERY_FRAMES && done !== total) return;
    written = done;
    await writeStatus(jobId, { framesDone: done, progress: done / total });
  };
}

async function renderRange(
  browser: Browser,
  jobId: string,
  url: string,
  plan: RenderPlan,
  framesDir: string,
  range: FrameRange,
  onFrame: () => Promise<void>,
): Promise<unknown> {
  const context = await browser.newContext({
    viewport: { width: plan.width, height: plan.height },
    deviceScaleFactor: plan.scale,
  });
  await context.route("**/*", (route) =>
    isAllowedRenderRequest(route.request().url(), url, jobId) ? route.continue() : route.abort("blockedbyclient"),
  );
  try {
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(url, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS });
    try {
      await page.waitForFunction(
        () => {
          const w = window as unknown as PreviewGlobals;
          return w.__ready === true && typeof w.__seek === "function" && Boolean(w.__videoMeta);
        },
        undefined,
        { timeout: READY_TIMEOUT_MS },
      );
    } catch (error) {
      const detail = pageErrors.length ? `page error: ${pageErrors[0]}` : (error as Error).message;
      throw new Error(`Preview page never became ready (${detail})`);
    }
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForTimeout(FONT_SETTLE_MS);

    const shot = plan.frameExt === "png"
      ? { type: "png" as const, omitBackground: plan.transparent }
      : { type: "jpeg" as const, quality: 95 };
    const clip = { x: 0, y: 0, width: plan.width, height: plan.height };

    for (let index = range.start; index < range.end; index++) {
      await withTimeout(
        page.evaluate(
          (t) =>
            new Promise<void>((resolve, reject) => {
              const w = window as unknown as PreviewGlobals;
              if (typeof w.__seek === "function") w.__seek(t);
              // Pending work (textures) first, then two frames so the drawn canvas is composited.
              const idle = typeof w.__whenIdle === "function" ? w.__whenIdle() : Promise.resolve();
              idle.then(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())), reject);
            }),
          frameTime(plan, index),
        ),
        SEEK_TIMEOUT_MS,
        `Seeking frame ${index}`,
      );
      if (pageErrors.length) throw new Error(`Page error while rendering frame ${index}: ${pageErrors[0]}`);
      const renderError = await page.evaluate(() => (window as unknown as { __renderError?: string }).__renderError ?? null);
      if (renderError) throw new Error(`Scene error while rendering frame ${index}: ${renderError}`);
      await page.screenshot({ ...shot, clip, path: path.join(framesDir, frameFileName(index, plan.frameExt)) });
      await onFrame();
    }
    return await page.evaluate(() => {
      const w = window as unknown as { __getAudioClips?: () => unknown };
      return typeof w.__getAudioClips === "function" ? w.__getAudioClips() : [];
    });
  } finally {
    await context.close();
  }
}

/**
 * Renders every frame of the job's export range. Resolves with the plan and
 * the frames directory; rejects (after closing the browser) on any failure.
 * The caller owns status.json's `state` before/after; this only writes progress.
 */
export async function renderJob(jobId: string, origin: string, opts: RenderOptions = {}): Promise<RenderResult> {
  const [project, options] = await Promise.all([readProject(jobId), readOptions(jobId)]);
  if (!project || !options) throw new Error(`Export job "${jobId}" has no project/options on disk`);
  const plan = resolvePlan(project, options);
  const framesDir = path.join(jobDir(jobId), "frames");
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });

  const url = opts.pageUrl ?? previewUrl(origin, jobId, plan.transparent);
  const ranges = partitionFrames(plan.frameCount, opts.workers ?? defaultWorkers());
  await writeStatus(jobId, { state: "rendering", framesDone: 0, framesTotal: plan.frameCount, progress: 0 });
  const onFrame = createProgress(jobId, plan.frameCount);

  const browser = await chromium.launch({
    executablePath: resolveChromiumPath(),
    args: chromiumLaunchArgs(projectUsesWebGL(project)),
    chromiumSandbox: chromiumSandboxEnabled(),
  });
  let reported: unknown[];
  try {
    reported = await Promise.all(ranges.map((range) => renderRange(browser, jobId, url, plan, framesDir, range, onFrame)));
  } finally {
    await browser.close();
  }
  return { plan, framesDir, audio: mergeClips(reported) };
}

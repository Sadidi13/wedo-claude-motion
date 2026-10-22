/**
 * Headless frame renderer (CONTRACTS.md §6).
 *
 * Opens `${origin}/preview?job=<id>&__render=1[&transparent=1]` in Chromium
 * (playwright-core), waits for the runtime globals, then drives
 * `window.__seek(t)` frame by frame and screenshots the stage clip into
 * `<jobDir>/frames/f_%06d.(png|jpg)`. Frames are split into contiguous ranges,
 * one BrowserContext + page per worker. status.json is updated every 10 frames
 * and on completion; the browser is always closed in `finally`.
 *
 * Tests pass `pageUrl` to render any page that implements the same globals.
 */

import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";
import { jobDir, readOptions, readProject, writeStatus } from "./jobs";
import { frameFileName, frameTime, partitionFrames, resolvePlan, type FrameRange, type RenderPlan } from "./plan";

export interface RenderOptions {
  /** parallel browser contexts (default 3, capped at the frame count) */
  workers?: number;
  /** full page URL to render instead of `${origin}/preview?job=…` (tests) */
  pageUrl?: string;
}

export interface RenderResult {
  plan: RenderPlan;
  framesDir: string;
}

/** Minimal view of the globals the runtime installs (see src/runtime/globals.ts). */
interface PreviewGlobals {
  __ready?: boolean;
  __seek?: (time: number) => void;
  __videoMeta?: unknown;
}

export const DEFAULT_WORKERS = 3;
const FALLBACK_CHROMIUM = "/opt/pw-browsers/chromium";
const READY_TIMEOUT_MS = 60_000;
const NAVIGATION_TIMEOUT_MS = 90_000;
const SEEK_TIMEOUT_MS = 15_000;
const FONT_SETTLE_MS = 300;
const STATUS_EVERY_FRAMES = 10;
const LAUNCH_ARGS = ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"];

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
  url: string,
  plan: RenderPlan,
  framesDir: string,
  range: FrameRange,
  onFrame: () => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: plan.width, height: plan.height },
    deviceScaleFactor: plan.scale,
  });
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
            new Promise<void>((resolve) => {
              const w = window as unknown as PreviewGlobals;
              if (typeof w.__seek === "function") w.__seek(t);
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
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
  const ranges = partitionFrames(plan.frameCount, opts.workers ?? DEFAULT_WORKERS);
  await writeStatus(jobId, { state: "rendering", framesDone: 0, framesTotal: plan.frameCount, progress: 0 });
  const onFrame = createProgress(jobId, plan.frameCount);

  const browser = await chromium.launch({ executablePath: resolveChromiumPath(), args: LAUNCH_ARGS });
  try {
    await Promise.all(ranges.map((range) => renderRange(browser, url, plan, framesDir, range, onFrame)));
  } finally {
    await browser.close();
  }
  return { plan, framesDir };
}

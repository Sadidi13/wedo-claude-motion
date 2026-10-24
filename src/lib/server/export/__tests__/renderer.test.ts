import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectFile } from "@/lib/types";
import {
  CHROMIUM_LAUNCH_ARGS,
  DEFAULT_WORKERS,
  defaultWorkers,
  chromiumLaunchArgs,
  chromiumSandboxEnabled,
  isAllowedRenderRequest,
  previewUrl,
  projectUsesWebGL,
  resolveChromiumPath,
  webglLaunchArgs,
  webglMode,
} from "../renderer";

describe("previewUrl", () => {
  it("targets /preview in render mode with the job id", () => {
    expect(previewUrl("http://localhost:3000", "abcdefghij", false)).toBe("http://localhost:3000/preview?job=abcdefghij&__render=1");
  });

  it("adds transparent=1 only for alpha exports and keeps a non-root origin", () => {
    expect(previewUrl("https://studio.example.com", "abcdefghij", true)).toBe(
      "https://studio.example.com/preview?job=abcdefghij&__render=1&transparent=1",
    );
  });
});

describe("resolveChromiumPath", () => {
  const original = process.env.CHROMIUM_PATH;
  afterEach(() => {
    if (original === undefined) delete process.env.CHROMIUM_PATH;
    else process.env.CHROMIUM_PATH = original;
  });

  it("prefers CHROMIUM_PATH", () => {
    process.env.CHROMIUM_PATH = "/custom/chrome";
    expect(resolveChromiumPath()).toBe("/custom/chrome");
  });

  it("falls back to an installed browser only when one exists", () => {
    delete process.env.CHROMIUM_PATH;
    const resolved = resolveChromiumPath();
    // undefined (playwright-core uses its own download) or a browser that really exists on disk
    expect(resolved === undefined || existsSync(resolved)).toBe(true);
  });

  it("renders with half the cores in parallel, between 2 and 8 pages", () => {
    expect(defaultWorkers({}, 0)).toBe(DEFAULT_WORKERS);
    expect(defaultWorkers({}, 2)).toBe(2);
    expect(defaultWorkers({}, 12)).toBe(6);
    expect(defaultWorkers({}, 64)).toBe(8);
    expect(defaultWorkers({ MOTION_STUDIO_EXPORT_WORKERS: "4" }, 64)).toBe(4);
    expect(defaultWorkers({ MOTION_STUDIO_EXPORT_WORKERS: "zero" }, 12)).toBe(6);
  });
});

describe("chromiumSandboxEnabled", () => {
  it("keeps the sandbox on for desktop users", () => {
    expect(chromiumSandboxEnabled({}, "win32", undefined)).toBe(true);
    expect(chromiumSandboxEnabled({}, "darwin", 501)).toBe(true);
    expect(chromiumSandboxEnabled({}, "linux", 1000)).toBe(true);
    expect(CHROMIUM_LAUNCH_ARGS).not.toContain("--no-sandbox");
  });

  it("turns it off only as root on Linux or when explicitly asked", () => {
    expect(chromiumSandboxEnabled({}, "linux", 0)).toBe(false);
    expect(chromiumSandboxEnabled({ MOTION_STUDIO_CHROMIUM_NO_SANDBOX: "1" }, "win32", undefined)).toBe(false);
  });
});

describe("isAllowedRenderRequest", () => {
  const page = "http://localhost:3000/preview?job=abcdefghijklmn&__render=1";
  const allowed = (url: string) => isAllowedRenderRequest(url, page, "abcdefghijklmn");

  it("lets the page, its bundles and this job's project load", () => {
    expect(allowed(page)).toBe(true);
    expect(allowed("http://localhost:3000/_next/static/chunks/app.js")).toBe(true);
    expect(allowed("http://localhost:3000/api/export/abcdefghijklmn/project")).toBe(true);
    expect(allowed("data:image/png;base64,AAAA")).toBe(true);
    expect(allowed("https://fonts.gstatic.com/s/inter.woff2")).toBe(true);
  });

  it("blocks the scene from calling the app's API or other jobs", () => {
    expect(allowed("http://localhost:3000/api/export")).toBe(false);
    expect(allowed("http://localhost:3000/api/bridge/requests")).toBe(false);
    expect(allowed("http://localhost:3000/api/export/otherjob000000/project")).toBe(false);
    expect(allowed("http://localhost:3000/")).toBe(false);
  });
});

describe("WebGL exports", () => {
  const project = (content: string, kind: ProjectFile["kind"] = "jsx") => ({
    files: { "scene.jsx": { path: "scene.jsx", kind, content } },
  });

  it("detects scenes that draw with WebGL", () => {
    expect(projectUsesWebGL(project('import * as THREE from "three";'))).toBe(true);
    expect(projectUsesWebGL(project("import { Stage, Three3D } from './animations.jsx';"))).toBe(true);
    expect(projectUsesWebGL(project('const gl = canvas.getContext("webgl2");', "js"))).toBe(true);
    expect(projectUsesWebGL(project('import { Stage } from "./animations.jsx"; // threefold'))).toBe(false);
    expect(projectUsesWebGL(project("body { content: 'Three3D'; }", "css"))).toBe(false);
  });

  it("uses the GPU with a SwiftShader fallback by default, or SwiftShader only when asked", () => {
    expect(webglMode({})).toBe("gpu");
    expect(webglMode({ MOTION_STUDIO_WEBGL: "swiftshader" })).toBe("swiftshader");
    expect(webglLaunchArgs("gpu")).toEqual(["--enable-unsafe-swiftshader"]);
    expect(webglLaunchArgs("swiftshader")).toEqual(["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]);
  });

  it("adds the WebGL switches only to 3D exports and never drops the sandbox", () => {
    expect(chromiumLaunchArgs(false, {})).toEqual(CHROMIUM_LAUNCH_ARGS);
    expect(chromiumLaunchArgs(true, {})).toEqual([...CHROMIUM_LAUNCH_ARGS, "--enable-unsafe-swiftshader"]);
    expect(chromiumLaunchArgs(true, { MOTION_STUDIO_WEBGL: "swiftshader" })).toContain("--use-angle=swiftshader");
    expect(chromiumLaunchArgs(true, {})).not.toContain("--no-sandbox");
  });
});

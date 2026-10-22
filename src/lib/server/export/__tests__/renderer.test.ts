import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_WORKERS, previewUrl, resolveChromiumPath } from "../renderer";

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

  it("falls back to the box-level Chromium only when it exists", () => {
    delete process.env.CHROMIUM_PATH;
    const expected = existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
    expect(resolveChromiumPath()).toBe(expected);
  });

  it("defaults to three parallel contexts", () => {
    expect(DEFAULT_WORKERS).toBe(3);
  });
});

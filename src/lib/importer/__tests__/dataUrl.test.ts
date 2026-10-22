/** MIME detection and base64 / data URL round trips. */
import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, bytesToDataUrl, dataUrlToBytes, isAssetPath, mimeTypeFor } from "../dataUrl";
import { PNG_BASE64, PNG_BYTES } from "./fixtures";

describe("dataUrl", () => {
  it("detects MIME types by extension, case-insensitively", () => {
    expect(mimeTypeFor("assets/Logo.PNG")).toBe("image/png");
    expect(mimeTypeFor("a/b.woff2")).toBe("font/woff2");
    expect(mimeTypeFor("clip.mp4")).toBe("video/mp4");
    expect(mimeTypeFor("notes.txt")).toBe("application/octet-stream");
    expect(isAssetPath("x.svg")).toBe(true);
    expect(isAssetPath("x.jsx")).toBe(false);
    expect(isAssetPath("noext")).toBe(false);
  });

  it("round-trips every byte value and large buffers", () => {
    const all = new Uint8Array(256).map((_, i) => i);
    expect(base64ToBytes(bytesToBase64(all))).toEqual(all);
    const big = new Uint8Array(70_001).map((_, i) => (i * 31) % 256);
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
    expect(bytesToBase64(PNG_BYTES)).toBe(PNG_BASE64);
  });

  it("encodes and decodes data URLs", () => {
    const url = bytesToDataUrl(PNG_BYTES, "image/png");
    expect(url).toBe(`data:image/png;base64,${PNG_BASE64}`);
    expect(dataUrlToBytes(url)).toEqual({ mime: "image/png", bytes: PNG_BYTES });
    expect(dataUrlToBytes("data:text/plain,hello%20world")).toEqual({
      mime: "text/plain",
      bytes: new TextEncoder().encode("hello world"),
    });
    expect(() => dataUrlToBytes("https://x/y.png")).toThrow(/data: URL/);
  });
});

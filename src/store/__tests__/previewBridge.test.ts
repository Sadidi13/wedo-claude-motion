import { describe, expect, it, vi } from "vitest";
import { createPreviewBridge, isPreviewMessage } from "../previewBridge";
import { makeProject } from "./fixture";

describe("isPreviewMessage", () => {
  it("accepts every preview -> editor message", () => {
    expect(isPreviewMessage({ type: "ready", meta: { width: 1, height: 1, duration: 1, fps: 30 } })).toBe(true);
    expect(isPreviewMessage({ type: "layerRects", rects: [] })).toBe(true);
    expect(isPreviewMessage({ type: "layerRects", rects: [{ id: "a", x: 0, y: 0, width: 1, height: 1 }] })).toBe(true);
    expect(isPreviewMessage({ type: "select", id: "a" })).toBe(true);
    expect(isPreviewMessage({ type: "select", id: null })).toBe(true);
    expect(isPreviewMessage({ type: "error", message: "boom", stack: "at x" })).toBe(true);
    expect(isPreviewMessage({ type: "warning", message: "hmm" })).toBe(true);
  });

  it("rejects malformed messages", () => {
    expect(isPreviewMessage({ type: "ready" })).toBe(false);
    expect(isPreviewMessage({ type: "layerRects", rects: [{ id: "a" }] })).toBe(false);
    expect(isPreviewMessage({ type: "select" })).toBe(false);
    expect(isPreviewMessage({ type: "error", message: 1 })).toBe(false);
    expect(isPreviewMessage({ type: "seek", time: 1 })).toBe(false);
    expect(isPreviewMessage(null)).toBe(false);
    expect(isPreviewMessage("ready")).toBe(false);
  });
});

describe("createPreviewBridge", () => {
  it("posts typed messages to the target with the given origin and drops them without a target", () => {
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as Window;
    let current: Window | null = null;
    const bridge = createPreviewBridge(() => current, "http://editor.test");

    bridge.seek(1);
    expect(postMessage).not.toHaveBeenCalled();

    current = target;
    const project = makeProject();
    bridge.load(project, 2);
    bridge.seek(1.5);
    bridge.getLayerRects();
    bridge.highlight("a");
    bridge.setTransparent(true);
    expect(postMessage.mock.calls.map((c) => c[0])).toEqual([
      { type: "load", project, time: 2 },
      { type: "seek", time: 1.5 },
      { type: "getLayerRects" },
      { type: "highlight", id: "a" },
      { type: "setTransparent", transparent: true },
    ]);
    expect(postMessage.mock.calls.every((c) => c[1] === "http://editor.test")).toBe(true);
  });
});

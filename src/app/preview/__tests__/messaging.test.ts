import { describe, expect, it } from "vitest";
import type { Project } from "@/lib/types";
import { isProjectLike } from "../guards";
import { isEditorMessage } from "../messaging";

const project: Project = {
  id: "p1",
  name: "Demo",
  entry: "scene.jsx",
  files: { "scene.jsx": { path: "scene.jsx", kind: "jsx", content: "export default () => null" } },
  meta: { width: 1280, height: 720, duration: 8, fps: 30 },
  createdAt: "2026-10-22T00:00:00Z",
  updatedAt: "2026-10-22T00:00:00Z",
};

describe("isProjectLike", () => {
  it("accepts a well-formed project and rejects partial ones", () => {
    expect(isProjectLike(project)).toBe(true);
    expect(isProjectLike({ ...project, meta: { width: 1 } })).toBe(false);
    expect(isProjectLike({ ...project, files: { a: { path: "a" } } })).toBe(false);
    expect(isProjectLike(null)).toBe(false);
    expect(isProjectLike("project")).toBe(false);
  });
});

describe("isEditorMessage", () => {
  it("accepts every editor -> preview message", () => {
    expect(isEditorMessage({ type: "load", project })).toBe(true);
    expect(isEditorMessage({ type: "load", project, time: 1.5 })).toBe(true);
    expect(isEditorMessage({ type: "seek", time: 2 })).toBe(true);
    expect(isEditorMessage({ type: "getLayerRects" })).toBe(true);
    expect(isEditorMessage({ type: "highlight", id: "title" })).toBe(true);
    expect(isEditorMessage({ type: "highlight", id: null })).toBe(true);
    expect(isEditorMessage({ type: "setTransparent", transparent: true })).toBe(true);
  });

  it("rejects malformed or foreign messages", () => {
    expect(isEditorMessage({ type: "load" })).toBe(false);
    expect(isEditorMessage({ type: "seek", time: "2" })).toBe(false);
    expect(isEditorMessage({ type: "seek", time: NaN })).toBe(false);
    expect(isEditorMessage({ type: "highlight" })).toBe(false);
    expect(isEditorMessage({ type: "setTransparent", transparent: "yes" })).toBe(false);
    expect(isEditorMessage({ type: "ready" })).toBe(false);
    expect(isEditorMessage("load")).toBe(false);
    expect(isEditorMessage(undefined)).toBe(false);
  });
});

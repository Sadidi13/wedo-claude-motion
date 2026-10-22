/** createBlankProject: defaults, meta overrides, one named Sprite with ids. */
import { describe, expect, it } from "vitest";
import { listLayerIds, parseScene } from "@/lib/parser";
import { createBlankProject } from "../blank";

describe("createBlankProject", () => {
  it("creates a 1920×1080, 10 s, 30 fps scene with one centred title Sprite", () => {
    const project = createBlankProject();
    expect(project).toMatchObject({ name: "Untitled scene", entry: "scene.jsx", origin: "blank" });
    expect(project.meta).toEqual({ width: 1920, height: 1080, duration: 10, fps: 30, background: "#0b0b12" });
    const scene = parseScene(project.files["scene.jsx"].content);
    expect(scene.warnings).toEqual([]);
    expect(scene.layers).toHaveLength(1);
    expect(scene.layers[0]).toMatchObject({ kind: "sprite", name: "Title", start: 0, end: 10 });
    expect(scene.layers[0].children[0].children[0]).toMatchObject({ kind: "text", textPreview: "Your title" });
    expect(listLayerIds(project.files["scene.jsx"].content)).toEqual(["sprite-title", "div-title-center", "h1-title"]);
  });

  it("applies meta overrides and the name", () => {
    const project = createBlankProject({ width: 1080, height: 1080, duration: 4, background: "#fff" }, "Square");
    expect(project.name).toBe("Square");
    expect(project.meta).toEqual({ width: 1080, height: 1080, duration: 4, fps: 30, background: "#fff" });
    expect(parseScene(project.files["scene.jsx"].content).layers[0].end).toBe(4);
  });
});

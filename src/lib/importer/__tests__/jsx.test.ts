/** importFromJsx: ids, export default, untouched clean scenes, Stage wrapping. */
import { describe, expect, it } from "vitest";
import { listLayerIds, parseScene } from "@/lib/parser";
import { importFromJsx, importFromJsxDetailed } from "../jsx";
import { BARE_SCENE, CLEAN_SCENE } from "./fixtures";

describe("importFromJsx", () => {
  it("adds layer ids and an export default for a bare scene", () => {
    const { project, warnings } = importFromJsxDetailed(BARE_SCENE, { name: "Bare" });
    const scene = project.files["scene.jsx"].content;
    expect(warnings).toEqual([]);
    expect(project).toMatchObject({ name: "Bare", entry: "scene.jsx", origin: "jsx" });
    expect(project.meta).toEqual({ width: 1280, height: 720, duration: 8, fps: 30, background: "#0b0b12" });
    expect(scene.endsWith("export default Scene;\n")).toBe(true);
    const ids = listLayerIds(scene);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(ids.every((id) => /^[a-z0-9]+-[a-z0-9]{6}$/.test(id))).toBe(true);
    expect(parseScene(scene).warnings).toEqual([]);
  });

  it("keeps a clean scene byte-for-byte", () => {
    const project = importFromJsx(CLEAN_SCENE);
    expect(project.files["scene.jsx"].content).toBe(CLEAN_SCENE);
    expect(project.name).toBe("Imported scene");
    expect(project.id).toMatch(/^[\w-]{12}$/);
    expect(project.createdAt).toBe(project.updatedAt);
  });

  it("wraps a Stage-less component file and detaches its default export", () => {
    const { project, warnings } = importFromJsxDetailed(
      `import React from "react";\nexport default function App() {\n  return <div>x</div>;\n}\n`,
    );
    const scene = project.files["scene.jsx"].content;
    expect(scene).toContain("\nfunction App() {");
    expect(scene).not.toContain("export default function App");
    expect(scene).toContain("<Stage width={1920} height={1080} duration={10} fps={30}>");
    expect(scene).toMatch(/<App data-layer-id="[a-z0-9-]+" \/>/);
    expect(warnings).toEqual([expect.stringContaining("<App> was wrapped in a Stage")]);
    expect(parseScene(scene).layers.map((l) => l.tag)).toEqual(["App"]);
  });

  it("falls back to the detected meta with a warning when the file does not parse", () => {
    const { project, warnings } = importFromJsxDetailed(`window.__videoMeta = { width: 640, height: 360 };\nconst = ;`);
    expect(project.meta).toEqual({ width: 640, height: 360, duration: 10, fps: 30 });
    expect(warnings).toEqual([expect.stringContaining("could not be parsed"), expect.stringContaining("could not be parsed as a Stage scene")]);
  });
});

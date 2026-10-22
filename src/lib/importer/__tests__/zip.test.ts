/** Zip round trip: Claude Design archive → Project → exportProjectZip → Project. */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseScene } from "@/lib/parser";
import { exportProjectZip } from "../exportZip";
import { importFromZip, importFromZipDetailed } from "../zip";
import { CLEAN_SCENE, PNG_BASE64, PNG_BYTES } from "./fixtures";

const ARTIFACT_HTML = `<!doctype html><html><head><title>Archive</title></head><body><div id="root"></div>
<script type="text/babel" data-type="module">
import React from "react";
import { Stage, Sprite } from "./animations.jsx";
export default function Scene() {
  return (
    <Stage width={1280} height={720} duration={5} fps={25}>
      <Sprite start={0} end={5}><img src="assets/pixel.png" alt="" /></Sprite>
    </Stage>
  );
}
</script></body></html>`;

async function designArchive(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("my-project/artifact.html", ARTIFACT_HTML);
  zip.file("my-project/manifest.json", JSON.stringify({ name: "Zip scene", createdAt: "2026-01-02T00:00:00.000Z" }));
  zip.file("my-project/assets/pixel.png", PNG_BYTES);
  zip.file("my-project/assets/data.bin", new Uint8Array([1, 2, 3]));
  zip.file("my-project/comments.json", "[]");
  zip.file("my-project/notes.txt", "ignored");
  zip.file("my-project/__MACOSX/._artifact.html", "junk");
  zip.file("my-project/.DS_Store", "junk");
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("importFromZip", () => {
  it("imports a Claude Design archive: assets as data URLs, entry scene.jsx, manifest name/date", async () => {
    const { project, warnings } = await importFromZipDetailed(await designArchive());
    expect(project).toMatchObject({ name: "Zip scene", entry: "scene.jsx", origin: "claude-design-zip", createdAt: "2026-01-02T00:00:00.000Z" });
    expect(project.meta).toEqual({ width: 1280, height: 720, duration: 5, fps: 25 });
    expect(Object.keys(project.files).sort()).toEqual(["assets/data.bin", "assets/pixel.png", "comments.json", "scene.jsx"]);
    expect(project.files["assets/pixel.png"]).toEqual({ path: "assets/pixel.png", kind: "asset", content: `data:image/png;base64,${PNG_BASE64}` });
    expect(project.files["assets/data.bin"].content).toBe("data:application/octet-stream;base64,AQID");
    expect(project.files["comments.json"].kind).toBe("json");
    const scene = parseScene(project.files["scene.jsx"].content);
    expect(scene.layers[0].children[0]).toMatchObject({ kind: "image" });
    expect(project.files["scene.jsx"].content).toContain('src="assets/pixel.png"');
    expect(warnings).toEqual([expect.stringContaining("notes.txt")]);
  });

  it("prefers a scene .jsx with <Stage> over a page that only bootstraps it, keeping animations.jsx", async () => {
    const zip = new JSZip();
    zip.file("index.html", `<html><body><div id="root"></div><script src="animations.jsx"></script><script type="module" src="scene.jsx"></script></body></html>`);
    zip.file("scene.jsx", CLEAN_SCENE);
    zip.file("animations.jsx", "export const Stage = () => null;");
    const project = await importFromZip(await zip.generateAsync({ type: "uint8array" }), { name: "Boot" });
    expect(project.name).toBe("Boot");
    expect(Object.keys(project.files).sort()).toEqual(["animations.jsx", "scene.jsx"]);
    expect(project.files["scene.jsx"].content).toBe(CLEAN_SCENE);
    expect(project.meta.duration).toBe(8);
  });

  it("imports a lone scene file and rejects archives without any scene", async () => {
    const zip = new JSZip();
    zip.file("product-launch.jsx", CLEAN_SCENE);
    const project = await importFromZip(await zip.generateAsync({ type: "arraybuffer" }));
    expect(project.name).toBe("product launch");
    expect(project.files["scene.jsx"].content).toBe(CLEAN_SCENE);

    const empty = new JSZip();
    empty.file("readme.md", "nothing here");
    await expect(importFromZip(await empty.generateAsync({ type: "arraybuffer" }))).rejects.toThrow(/no scene/);
  });
});

describe("exportProjectZip", () => {
  it("writes files, decoded assets, manifest, index.html and README, and re-imports losslessly", async () => {
    const original = await importFromZip(await designArchive());
    const blob = await exportProjectZip(original);
    expect(blob.type).toBe("application/zip");

    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort()).toEqual([
      "README.txt", "assets/data.bin", "assets/pixel.png", "comments.json", "index.html", "manifest.json", "scene.jsx",
    ]);
    expect(await zip.file("assets/pixel.png")!.async("uint8array")).toEqual(PNG_BYTES);
    expect(await zip.file("scene.jsx")!.async("string")).toBe(original.files["scene.jsx"].content);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest).toMatchObject({ generator: "motion-studio", name: "Zip scene", entry: "scene.jsx", meta: original.meta, createdAt: original.createdAt });
    const index = await zip.file("index.html")!.async("string");
    expect(index).toContain('"react": "https://esm.sh/react@19"');
    expect(index).toContain("importmap");
    expect(index).toContain("animations.jsx");
    expect(await zip.file("README.txt")!.async("string")).toContain("Motion Studio");

    const { project: again, warnings } = await importFromZipDetailed(blob);
    expect(warnings).toEqual([]);
    expect(again.files).toEqual(original.files);
    expect(again.meta).toEqual(original.meta);
    expect(again).toMatchObject({ name: "Zip scene", entry: "scene.jsx", createdAt: original.createdAt });
  });
});

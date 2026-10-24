/** Version history without IndexedDB (the in-memory fallback the node test environment uses). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/lib/types";
import { MAX_VERSIONS, listVersions, projectAtVersion, saveVersion } from "../versions";
import { SCENE, makeProject } from "./fixture";

let clock = 1_000;
beforeEach(() => {
  vi.spyOn(Date, "now").mockImplementation(() => (clock += 1_000));
});
afterEach(() => {
  vi.restoreAllMocks();
});

const withAsset = (project: Project, id: string): Project => ({
  ...project,
  id,
  files: {
    ...project.files,
    "styles.css": { path: "styles.css", kind: "css", content: "h1 { color: red; }" },
    "assets/logo.png": { path: "assets/logo.png", kind: "asset", content: "data:image/png;base64,AAAA" },
  },
});

describe("saveVersion / listVersions", () => {
  it("keeps text files only, newest first, and skips a save that changes nothing", async () => {
    const project = withAsset(makeProject(), "p-basic");
    const first = await saveVersion(project, "Opened “Test”");
    expect(first).toMatchObject({ projectId: "p-basic", label: "Opened “Test”", entry: "scene.jsx" });
    expect(Object.keys(first!.files).sort()).toEqual(["scene.jsx", "styles.css"]);
    expect(await saveVersion(project, "again")).toBeNull();

    const edited = { ...project, files: { ...project.files, "scene.jsx": { ...project.files["scene.jsx"], content: SCENE.replace("Hello", "Hi") } } };
    const second = await saveVersion(edited, "Claude: shorter title");
    expect((await listVersions("p-basic")).map((version) => version.id)).toEqual([second!.id, first!.id]);
    expect(await listVersions("someone-else")).toEqual([]);
  });

  it(`drops the oldest beyond ${MAX_VERSIONS} versions per project`, async () => {
    const base = makeProject();
    const ids: string[] = [];
    for (let i = 0; i < MAX_VERSIONS + 3; i++) {
      const version = await saveVersion({ ...base, id: "p-many", files: { "scene.jsx": { ...base.files["scene.jsx"], content: `${SCENE}\n// ${i}` } } }, `v${i}`);
      ids.push(version!.id);
    }
    const kept = await listVersions("p-many");
    expect(kept).toHaveLength(MAX_VERSIONS);
    expect(kept[0].label).toBe(`v${MAX_VERSIONS + 2}`);
    expect(kept[kept.length - 1].label).toBe("v3");
  });
});

describe("projectAtVersion", () => {
  it("puts the version's text files back, removes newer text files and keeps assets", async () => {
    const project = withAsset(makeProject(), "p-restore");
    const version = (await saveVersion(project, "before"))!;
    const later: Project = {
      ...project,
      files: {
        "scene.jsx": { ...project.files["scene.jsx"], content: "changed" },
        "extra.jsx": { path: "extra.jsx", kind: "jsx", content: "export const x = 1;" },
        "assets/logo.png": project.files["assets/logo.png"],
      },
    };
    const restored = projectAtVersion(later, version);
    expect(Object.keys(restored.files).sort()).toEqual(["assets/logo.png", "scene.jsx", "styles.css"]);
    expect(restored.files["scene.jsx"].content).toBe(SCENE);
    expect(restored.files["assets/logo.png"]).toBe(project.files["assets/logo.png"]);
    expect(restored.id).toBe("p-restore");
  });
});

import { describe, expect, it } from "vitest";
import { LAST_PROJECT_KEY, projectStorageKey, readLastProject } from "../storage";

const project = {
  id: "abc",
  name: "Saved",
  entry: "scene.jsx",
  files: {},
  meta: { width: 1920, height: 1080, duration: 10, fps: 30 },
  createdAt: "",
  updatedAt: "",
};

function storage(entries: Record<string, string>) {
  return { getItem: (key: string) => entries[key] ?? null };
}

describe("readLastProject", () => {
  it("follows motion-studio:last to the project record", () => {
    const store = storage({ [LAST_PROJECT_KEY]: "abc", [projectStorageKey("abc")]: JSON.stringify(project) });
    expect(readLastProject(store)).toEqual(project);
  });

  it("returns null when nothing is saved, the record is missing or malformed", () => {
    expect(readLastProject(storage({}))).toBeNull();
    expect(readLastProject(storage({ [LAST_PROJECT_KEY]: "abc" }))).toBeNull();
    expect(readLastProject(storage({ [LAST_PROJECT_KEY]: "abc", [projectStorageKey("abc")]: "{not json" }))).toBeNull();
    expect(readLastProject(storage({ [LAST_PROJECT_KEY]: "abc", [projectStorageKey("abc")]: '{"id":"abc"}' }))).toBeNull();
    expect(readLastProject(undefined)).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTOSAVE_DELAY_MS,
  LAST_PROJECT_KEY,
  createAutosaver,
  deserializeProject,
  isProjectShape,
  projectStorageKey,
  readLastProject,
  saveProject,
  serializeProject,
  type StorageLike,
} from "../persistence";
import { makeProject } from "./fixture";

function fakeStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("serialisation", () => {
  it("round-trips a project", () => {
    const project = makeProject();
    expect(deserializeProject(serializeProject(project))).toEqual(project);
  });

  it("rejects malformed JSON and wrong shapes", () => {
    expect(deserializeProject("{nope")).toBeNull();
    expect(deserializeProject(null)).toBeNull();
    expect(deserializeProject('{"id":"a"}')).toBeNull();
    expect(isProjectShape({ ...makeProject(), meta: { width: "1280" } })).toBe(false);
    expect(isProjectShape({ ...makeProject(), files: { a: { path: "a" } } })).toBe(false);
    expect(isProjectShape(makeProject())).toBe(true);
  });
});

describe("storage helpers", () => {
  it("saveProject writes the record and the last pointer; readLastProject follows it", () => {
    const storage = fakeStorage();
    const project = makeProject();
    expect(saveProject(project, storage)).toBe(true);
    expect(storage.map.get(LAST_PROJECT_KEY)).toBe(project.id);
    expect(storage.map.has(projectStorageKey(project.id))).toBe(true);
    expect(readLastProject(storage)).toEqual(project);
    storage.map.delete(projectStorageKey(project.id));
    expect(readLastProject(storage)).toBeNull();
  });

  it("tolerates a missing or throwing storage", () => {
    expect(saveProject(makeProject(), undefined)).toBe(false);
    expect(readLastProject(undefined)).toBeNull();
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(saveProject(makeProject(), broken)).toBe(false);
    expect(readLastProject(broken)).toBeNull();
    warn.mockRestore();
  });
});

describe("createAutosaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces and saves only the newest project", () => {
    const save = vi.fn();
    const autosaver = createAutosaver(save);
    const a = makeProject();
    const b = { ...a, name: "B" };
    autosaver.schedule(a);
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS / 2);
    autosaver.schedule(b);
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(b);
  });

  it("flush writes immediately and cancel drops the pending project", () => {
    const save = vi.fn();
    const autosaver = createAutosaver(save);
    autosaver.schedule(makeProject());
    autosaver.flush();
    expect(save).toHaveBeenCalledTimes(1);
    autosaver.schedule(makeProject());
    autosaver.cancel();
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2);
    expect(save).toHaveBeenCalledTimes(1);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, StageMeta } from "@/lib/types";
import { makeProject, SCENE } from "./fixture";

// The importer module is built concurrently; the store only needs createBlankProject from it.
vi.mock("@/lib/importer", () => ({
  createBlankProject: (meta?: Partial<StageMeta>, name = "Untitled"): Project => {
    const full: StageMeta = { width: 1280, height: 720, duration: 10, fps: 30, background: "#000", ...meta };
    const source = `import React from "react";
import { Stage } from "./animations.jsx";

export default function Scene() {
  return (
    <Stage width={${full.width}} height={${full.height}} duration={${full.duration}} fps={${full.fps}} background="${full.background}">
    </Stage>
  );
}
`;
    return {
      id: "blank",
      name,
      entry: "scene.jsx",
      files: { "scene.jsx": { path: "scene.jsx", kind: "jsx", content: source } },
      meta: full,
      createdAt: "",
      updatedAt: "",
      origin: "blank",
    };
  },
}));

const { useEditorStore, entrySource, chatKeyFor, MAX_HISTORY } = await import("../editorStore");

const store = useEditorStore;
const source = () => entrySource(store.getState().project!);
const ids = () => store.getState().scene!.layers.map((l) => l.id);

beforeEach(() => {
  store.getState().loadProject(makeProject());
});

describe("loadProject", () => {
  it("derives the scene, meta and resets selection / history / chat", () => {
    const s = store.getState();
    expect(s.scene?.layers.map((l) => l.name)).toEqual(["Background", "Title", "Cards", "Dynamic"]);
    expect(s.project?.meta).toEqual({ width: 1280, height: 720, duration: 8, fps: 30, background: "#0b0b12" });
    expect(s.parseError).toBeNull();
    expect(s.history).toEqual({ past: [], future: [] });
    expect(s.selectedId).toBeNull();
    expect(s.time).toBe(0);
  });

  it("adds missing layer ids and syncs meta from the Stage props", () => {
    const noIds = SCENE.replace(/ data-layer-id="[^"]*"/g, "");
    store.getState().loadProject({ ...makeProject(noIds), meta: { width: 1, height: 1, duration: 1, fps: 1 } });
    const s = store.getState();
    expect(s.scene?.layers).toHaveLength(4);
    expect(source()).toMatch(/data-layer-id="sprite-[a-z0-9]{6}"/);
    expect(s.project?.meta.duration).toBe(8);
    expect(s.scene?.warnings.filter((w) => w.includes("no data-layer-id"))).toEqual([]);
  });

  it("keeps an unparsable project loaded with parseError set", () => {
    store.getState().loadProject(makeProject("export default function Scene() { return <div>no stage</div>; }"));
    const s = store.getState();
    expect(s.scene).toBeNull();
    expect(s.parseError).toBeTruthy();
    expect(s.project).not.toBeNull();
  });

  it("newBlankProject loads a blank project with the requested meta", () => {
    store.getState().newBlankProject({ width: 640, height: 360, duration: 3 });
    const s = store.getState();
    expect(s.project?.origin).toBe("blank");
    expect(s.scene?.meta).toMatchObject({ width: 640, height: 360, duration: 3 });
    expect(s.scene?.layers).toEqual([]);
  });
});

describe("layer operations + history", () => {
  it("deleteLayer removes the layer, records history and moves the selection to the parent", () => {
    store.getState().select("card-a");
    store.getState().deleteLayer("card-a");
    const s = store.getState();
    expect(s.scene?.byId["card-a"]).toBeUndefined();
    expect(s.scene?.byId.row.children.map((c) => c.id)).toEqual(["card-b"]);
    expect(s.selectedId).toBe("row");
    expect(s.history.past).toHaveLength(1);
    expect(s.history.past[0]).toContain('data-layer-id="card-a"');
  });

  it("duplicateLayer inserts a copy after the original and selects it", () => {
    store.getState().duplicateLayer("title");
    const s = store.getState();
    expect(s.scene?.layers).toHaveLength(5);
    expect(ids()[2]).toBe(s.selectedId);
    expect(s.scene?.layers[2].name).toBe("Title copy");
    expect(s.history.past).toHaveLength(1);
  });

  it("moveLayer swaps siblings in source order", () => {
    store.getState().moveLayer("title", { direction: "down" });
    expect(ids()).toEqual(["bg", "cards", "title", "dyn"]);
    store.getState().moveLayer("title", { direction: "up" });
    expect(ids()).toEqual(["bg", "title", "cards", "dyn"]);
    expect(store.getState().history.past).toHaveLength(2);
  });

  it("setTiming writes frame-snapped literals and refuses non-Sprites with a notice", () => {
    store.getState().setTiming("title", { start: 1.004, end: 5.5 });
    const title = store.getState().scene!.byId.title;
    expect(title.start).toBe(1);
    expect(title.end).toBe(5.5);
    expect(source()).toContain("<Sprite start={1} end={5.5}");

    store.getState().setTiming("row", { start: 1 });
    expect(store.getState().notice?.kind).toBe("error");
    expect(store.getState().history.past).toHaveLength(1);
  });

  it("hidden / locked / rename / wrapInSprite", () => {
    const s = store.getState();
    s.setHidden("bg", true);
    s.setLocked("title", true);
    s.renameLayer("cards", "Feature cards");
    expect(store.getState().scene?.byId.bg.hidden).toBe(true);
    expect(store.getState().scene?.byId.title.locked).toBe(true);
    expect(store.getState().scene?.byId.cards.name).toBe("Feature cards");

    store.getState().deleteLayer("title");
    expect(store.getState().scene?.byId.title).toBeDefined();
    expect(store.getState().notice?.message).toMatch(/locked/);

    store.getState().wrapInSprite("row", 2.5, 5);
    const wrapped = store.getState();
    expect(wrapped.selectedId).toMatch(/^sprite-/);
    const sprite = wrapped.scene!.byId[wrapped.selectedId!];
    expect(sprite.kind).toBe("sprite");
    expect(sprite.start).toBe(2.5);
    expect(sprite.children[0].id).toBe("row");
  });

  it("replaceLayer forces the id and throws on invalid JSX without touching state", () => {
    store.getState().replaceLayer("card-a", `<p style={{ color: "red" }}>Alpha</p>`);
    expect(store.getState().scene?.byId["card-a"].name).toBe("Alpha");
    expect(source()).toMatch(/<p (data-layer-id="card-a" style=\{\{ color: "red" \}\}|style=\{\{ color: "red" \}\} data-layer-id="card-a")>Alpha<\/p>/);

    const before = source();
    expect(() => store.getState().replaceLayer("card-a", "<p>unclosed")).toThrow();
    expect(source()).toBe(before);
    expect(store.getState().history.past).toHaveLength(1);
  });

  it("setStageMeta updates the Stage props and the project meta", () => {
    store.getState().setStageMeta({ duration: 4, background: "#ffffff" });
    const s = store.getState();
    expect(s.scene?.meta.duration).toBe(4);
    expect(s.project?.meta.background).toBe("#ffffff");
    expect(s.scene?.byId.bg.range).toEqual({ start: 0, end: 4 });
  });

  it("addTextLayer / addShapeLayer insert a 2s Sprite at the playhead on top of the stack", () => {
    store.getState().seek(3);
    store.getState().addTextLayer();
    let s = store.getState();
    const text = s.scene!.layers[s.scene!.layers.length - 1];
    expect(text.id).toBe(s.selectedId);
    expect(text.kind).toBe("sprite");
    expect(text.start).toBe(3);
    expect(text.end).toBe(5);
    expect(text.name).toBe("Text");

    store.getState().seek(7.5);
    store.getState().addShapeLayer("circle");
    s = store.getState();
    const circle = s.scene!.layers[s.scene!.layers.length - 1];
    expect(circle.name).toBe("Circle");
    expect(circle.start).toBe(6);
    expect(circle.end).toBe(8);
    expect(s.history.past).toHaveLength(2);
  });

  it("setSource throws on a broken scene and leaves the state untouched", () => {
    const before = source();
    expect(() => store.getState().setSource("export default function X() { return <Stage>; }")).toThrow();
    expect(source()).toBe(before);
    expect(store.getState().parseError).toBeNull();
  });
});

describe("undo / redo", () => {
  it("round-trips through deletes and keeps the scene derived", () => {
    const original = source();
    store.getState().deleteLayer("title");
    store.getState().deleteLayer("cards");
    expect(ids()).toEqual(["bg", "dyn"]);

    store.getState().undo();
    expect(ids()).toEqual(["bg", "cards", "dyn"]);
    expect(store.getState().history.future).toHaveLength(1);

    store.getState().undo();
    expect(source()).toBe(original);
    expect(store.getState().history.past).toHaveLength(0);

    store.getState().redo();
    expect(ids()).toEqual(["bg", "cards", "dyn"]);
    store.getState().redo();
    expect(ids()).toEqual(["bg", "dyn"]);
    store.getState().redo(); // nothing left
    expect(ids()).toEqual(["bg", "dyn"]);
  });

  it("a new edit clears the redo stack and the stack is capped", () => {
    store.getState().deleteLayer("title");
    store.getState().undo();
    store.getState().deleteLayer("cards");
    expect(store.getState().history.future).toEqual([]);

    for (let i = 0; i < MAX_HISTORY + 20; i++) store.getState().setHidden("bg", i % 2 === 0);
    expect(store.getState().history.past).toHaveLength(MAX_HISTORY);
  });

  it("recordHistory:false does not push a snapshot", () => {
    store.getState().setSource(source().replace("Hello", "Hi"), { recordHistory: false });
    expect(store.getState().history.past).toHaveLength(0);
    expect(store.getState().scene?.byId["title-h1"].textPreview).toBe("Hi");
  });
});

describe("playback + selection + files", () => {
  it("seek clamps to the duration and step moves by frames / seconds", () => {
    store.getState().seek(20);
    expect(store.getState().time).toBe(8);
    store.getState().seek(-1);
    expect(store.getState().time).toBe(0);
    store.getState().stepFrames(3);
    expect(store.getState().time).toBeCloseTo(0.1, 6);
    store.getState().stepSeconds(1);
    expect(store.getState().time).toBeCloseTo(1.1, 6);
    store.getState().stepFrames(-100);
    expect(store.getState().time).toBe(0);
  });

  it("select ignores unknown ids and toggleCollapsed flips the flag", () => {
    store.getState().select("nope");
    expect(store.getState().selectedId).toBeNull();
    store.getState().select("row");
    expect(store.getState().selectedId).toBe("row");
    store.getState().toggleCollapsed("cards");
    expect(store.getState().collapsed.cards).toBe(true);
    store.getState().toggleCollapsed("cards");
    expect(store.getState().collapsed.cards).toBe(false);
  });

  it("selecting a layer inside collapsed groups expands its ancestors", () => {
    store.getState().toggleCollapsed("cards");
    store.getState().toggleCollapsed("row");
    store.getState().select("card-b");
    const s = store.getState();
    expect(s.selectedId).toBe("card-b");
    expect(s.collapsed.cards).toBe(false);
    expect(s.collapsed.row).toBe(false);
  });

  it("updateFile / addFile / removeFile bump filesRevision without history", () => {
    const rev = store.getState().filesRevision;
    store.getState().addFile({ path: "styles.css", kind: "css", content: ".a{}" });
    store.getState().updateFile("styles.css", ".a{color:red}");
    expect(store.getState().project?.files["styles.css"].content).toBe(".a{color:red}");
    store.getState().removeFile("styles.css");
    expect(store.getState().project?.files["styles.css"]).toBeUndefined();
    store.getState().removeFile("scene.jsx");
    expect(store.getState().project?.files["scene.jsx"]).toBeDefined();
    expect(store.getState().filesRevision).toBe(rev + 3);
    expect(store.getState().history.past).toHaveLength(0);
  });

  it("chat threads are keyed per layer / scene", () => {
    expect(chatKeyFor("layer", "title")).toBe("title");
    expect(chatKeyFor("scene", "title")).toBe("scene");
    expect(chatKeyFor("new", null)).toBe("scene");
    store.getState().appendChat("title", { role: "user", content: "make it red" });
    store.getState().appendChat("title", { role: "assistant", content: "Done", status: "applied" });
    expect(store.getState().chat.title.map((t) => t.role)).toEqual(["user", "assistant"]);
    store.getState().clearChat("title");
    expect(store.getState().chat.title).toBeUndefined();
  });
});

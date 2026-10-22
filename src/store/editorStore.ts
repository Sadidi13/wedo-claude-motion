/**
 * Editor store (CONTRACTS §4). The entry file's source string is the single
 * mutable truth; `scene` is re-derived with the parser on every change and
 * `project.meta` is kept in sync with the <Stage> props. History is a stack of
 * entry-source snapshots (max 200). Every file change bumps `filesRevision`,
 * which the Canvas watches to reload the preview iframe.
 *
 * Error policy:
 *   - `setSource`, `replaceLayer`, `insertLayer` THROW (ParseError / Error)
 *     and leave the state untouched, so the Code / Ask Claude tabs can show
 *     the message inline next to the text that caused it.
 *   - Button-style layer ops (delete, duplicate, move, retime, hide, lock,
 *     rename, wrap, stage meta, add text/shape/image) never throw: failures
 *     land in `notice` for the top bar to display.
 *   - `loadProject` / undo / redo are lenient: a source that does not parse is
 *     still loaded with `scene = null` and `parseError` set, so the user can
 *     repair it in the whole-scene Code tab.
 *
 * Playback runs a requestAnimationFrame loop here (real elapsed seconds, loops
 * or stops at the duration); the Canvas posts a `seek` whenever `time` changes.
 */
import { nanoid } from "nanoid";
import { create } from "zustand";
import { createBlankProject } from "@/lib/importer";
import {
  type LayerMove,
  deleteLayer as parserDeleteLayer,
  duplicateLayer as parserDuplicateLayer,
  ensureLayerIds,
  insertLayer as parserInsertLayer,
  moveLayer as parserMoveLayer,
  parseScene,
  replaceLayerSource,
  setLayerHidden,
  setLayerLocked,
  setLayerName,
  setLayerTiming,
  setStageMeta as parserSetStageMeta,
  wrapInSprite as parserWrapInSprite,
} from "@/lib/parser";
import type { AiChatTurn, AiScope, LayerRect, ParsedScene, Project, ProjectFile, StageMeta } from "@/lib/types";
import { ancestorIds } from "./layerRows";
import { createAutosaver, saveProject } from "./persistence";
import {
  type ShapeKind,
  assetPathFor,
  clipAtPlayhead,
  ensureSpriteImport,
  imageLayerTemplate,
  shapeLayerTemplate,
  textLayerTemplate,
} from "./templates";
import { clamp, snapToFrame } from "./time";

export const MAX_HISTORY = 200;

/** A chat turn as kept in memory: the contract's `AiChatTurn` plus UI bookkeeping. */
export interface ChatEntry extends AiChatTurn {
  id: string;
  /** epoch ms */
  at: number;
  /** assistant turns: whether the returned code was applied; error turns are not sent back as history */
  status?: "applied" | "error";
}

export interface EditorNotice {
  kind: "info" | "warning" | "error";
  message: string;
}

export interface EditorState {
  project: Project | null;
  /** derived from the entry source; null while `parseError` is set */
  scene: ParsedScene | null;
  parseError: string | null;
  selectedId: string | null;
  time: number;
  playing: boolean;
  loop: boolean;
  previewReady: boolean;
  previewError: string | null;
  /** stack trace of `previewError`, when the preview sent one */
  previewErrorDetail: string | null;
  layerRects: LayerRect[];
  history: { past: string[]; future: string[] };
  /** Ask Claude threads, keyed by layer id or "scene" (memory only) */
  chat: Record<string, ChatEntry[]>;
  /** collapsed groups in the layers panel / timeline (default: expanded) */
  collapsed: Record<string, boolean>;
  notice: EditorNotice | null;
  /** increments on every file-content change (preview reload trigger) */
  filesRevision: number;

  loadProject(project: Project): void;
  newBlankProject(meta?: Partial<StageMeta>): void;
  /** throws ParseError when `next` does not parse; state is untouched then */
  setSource(next: string, opts?: { recordHistory?: boolean }): void;
  setProjectName(name: string): void;

  select(id: string | null): void;
  seek(t: number): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  toggleLoop(): void;
  /** move the playhead by whole frames (negative = backwards) */
  stepFrames(frames: number): void;
  stepSeconds(seconds: number): void;

  deleteLayer(id: string): void;
  duplicateLayer(id: string): void;
  moveLayer(id: string, move: LayerMove): void;
  setTiming(id: string, timing: { start?: number; end?: number }): void;
  setHidden(id: string, hidden: boolean): void;
  setLocked(id: string, locked: boolean): void;
  renameLayer(id: string, name: string): void;
  wrapInSprite(id: string, start: number, end: number): void;
  /** throws on invalid JSX; returns the new layer id */
  insertLayer(parentId: string | null, jsx: string, index?: number): string;
  /** throws on invalid JSX (surfaced inline by the Code / Ask Claude tabs) */
  replaceLayer(id: string, jsx: string): void;
  setStageMeta(meta: Partial<StageMeta>): void;
  addTextLayer(): void;
  addImageLayer(file: File): Promise<void>;
  addShapeLayer(kind: ShapeKind): void;

  undo(): void;
  redo(): void;

  updateFile(path: string, content: string): void;
  addFile(file: ProjectFile): void;
  removeFile(path: string): void;

  toggleCollapsed(id: string): void;
  setPreviewReady(ready: boolean): void;
  setPreviewError(message: string | null, detail?: string | null): void;
  setLayerRects(rects: LayerRect[]): void;
  setNotice(notice: EditorNotice | null): void;
  appendChat(key: string, entry: Omit<ChatEntry, "id" | "at">): ChatEntry;
  clearChat(key: string): void;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Thread key for the Ask Claude tab: one per layer, one for the whole scene. */
export function chatKeyFor(scope: AiScope, layerId: string | null): string {
  return scope === "layer" && layerId ? layerId : "scene";
}

export function entrySource(project: Project): string {
  return project.files[project.entry]?.content ?? "";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface Derived {
  source: string;
  scene: ParsedScene;
}

/** ensureLayerIds + parseScene; throws ParseError. */
function derive(source: string): Derived {
  const withIds = ensureLayerIds(source).source;
  return { source: withIds, scene: parseScene(withIds) };
}

function withEntrySource(project: Project, source: string, meta: StageMeta | undefined): Project {
  const entry = project.files[project.entry] ?? { path: project.entry, kind: "jsx" as const, content: "" };
  return {
    ...project,
    files: { ...project.files, [project.entry]: { ...entry, content: source } },
    meta: meta ?? project.meta,
    updatedAt: new Date().toISOString(),
  };
}

function pushPast(history: EditorState["history"], source: string): EditorState["history"] {
  const past = [...history.past, source];
  return { past: past.length > MAX_HISTORY ? past.slice(past.length - MAX_HISTORY) : past, future: [] };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

const autosaver = createAutosaver((project) => {
  if (saveProject(project)) return;
  // Typically the localStorage quota (a large image asset). Edits are kept in
  // memory; tell the user so they can download the project as a zip.
  useEditorStore.setState({
    notice: {
      kind: "error",
      message: "Autosave failed: browser storage is full. Use Save to download the project as a .zip before reloading.",
    },
  });
});

// Playback loop state lives outside React / zustand: one loop per store.
let rafHandle: number | null = null;

function stopLoop(): void {
  if (rafHandle !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafHandle);
  rafHandle = null;
}

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

export const useEditorStore = create<EditorState>()((set, get) => {
  const durationOf = (): number => get().scene?.meta.duration ?? get().project?.meta.duration ?? 0;
  const fpsOf = (): number => get().scene?.meta.fps ?? get().project?.meta.fps ?? 30;

  const persist = (project: Project) => autosaver.schedule(project);

  /**
   * Commit a new entry source on top of `base` (defaults to the current project).
   * Strict: throws when the source does not parse. Returns the derived scene.
   */
  const commitSource = (next: string, opts: { recordHistory: boolean; base?: Project }): ParsedScene => {
    const current = get().project;
    if (!current) throw new Error("No project loaded");
    const base = opts.base ?? current;
    const { source, scene } = derive(next);
    const project = withEntrySource(base, source, scene.meta);
    set((state) => ({
      project,
      scene,
      parseError: null,
      history: opts.recordHistory ? pushPast(state.history, entrySource(current)) : state.history,
      time: clamp(state.time, 0, scene.meta.duration),
      filesRevision: state.filesRevision + 1,
    }));
    persist(project);
    return scene;
  };

  /** Lenient apply used by undo / redo: a broken snapshot is loaded with parseError set. */
  const applySnapshot = (source: string, history: EditorState["history"]) => {
    const current = get().project;
    if (!current) return;
    try {
      const { source: withIds, scene } = derive(source);
      const project = withEntrySource(current, withIds, scene.meta);
      set((state) => ({ project, scene, parseError: null, history, filesRevision: state.filesRevision + 1 }));
      persist(project);
    } catch (error) {
      const project = withEntrySource(current, source, undefined);
      set((state) => ({
        project,
        scene: null,
        parseError: errorMessage(error),
        history,
        filesRevision: state.filesRevision + 1,
      }));
      persist(project);
    }
  };

  /** Run a parser op as a button action: failures become a notice, never an exception. */
  const tryEdit = (op: (source: string) => string, after?: () => void): boolean => {
    const { project } = get();
    if (!project) return false;
    try {
      commitSource(op(entrySource(project)), { recordHistory: true });
      after?.();
      return true;
    } catch (error) {
      set({ notice: { kind: "error", message: errorMessage(error) } });
      return false;
    }
  };

  const guardUnlocked = (id: string): boolean => {
    const node = get().scene?.byId[id];
    if (node?.locked) {
      set({ notice: { kind: "warning", message: `"${node.name}" is locked. Unlock it to edit.` } });
      return false;
    }
    return true;
  };

  const startLoop = () => {
    if (typeof requestAnimationFrame !== "function") return;
    stopLoop();
    let last = performance.now();
    const tick = (now: number) => {
      const { playing, loop, time } = get();
      if (!playing) {
        rafHandle = null;
        return;
      }
      const duration = durationOf();
      const elapsed = (now - last) / 1000;
      last = now;
      let next = time + elapsed;
      if (next >= duration) {
        if (loop && duration > 0) {
          next %= duration;
        } else {
          set({ time: duration, playing: false });
          rafHandle = null;
          return;
        }
      }
      set({ time: next });
      rafHandle = requestAnimationFrame(tick);
    };
    rafHandle = requestAnimationFrame(tick);
  };

  const insertTemplate = (jsx: string, base?: Project): string => {
    const current = get().project;
    if (!current) throw new Error("No project loaded");
    const { source, id } = parserInsertLayer(ensureSpriteImport(entrySource(current)), null, jsx);
    commitSource(source, { recordHistory: true, base });
    set({ selectedId: id });
    return id;
  };

  return {
    project: null,
    scene: null,
    parseError: null,
    selectedId: null,
    time: 0,
    playing: false,
    loop: true,
    previewReady: false,
    previewError: null,
    previewErrorDetail: null,
    layerRects: [],
    history: { past: [], future: [] },
    chat: {},
    collapsed: {},
    notice: null,
    filesRevision: 0,

    loadProject(input) {
      stopLoop();
      let project = input;
      let scene: ParsedScene | null = null;
      let parseError: string | null = null;
      try {
        const derived = derive(entrySource(input));
        const metaChanged = JSON.stringify(derived.scene.meta) !== JSON.stringify(input.meta);
        if (derived.source !== entrySource(input) || metaChanged) {
          project = withEntrySource(input, derived.source, derived.scene.meta);
        }
        scene = derived.scene;
      } catch (error) {
        parseError = errorMessage(error);
      }
      set((state) => ({
        project,
        scene,
        parseError,
        selectedId: null,
        time: 0,
        playing: false,
        previewReady: false,
        previewError: null,
        previewErrorDetail: null,
        layerRects: [],
        history: { past: [], future: [] },
        chat: {},
        collapsed: {},
        notice: null,
        filesRevision: state.filesRevision + 1,
      }));
      persist(project);
    },

    newBlankProject(meta) {
      get().loadProject(createBlankProject(meta));
    },

    setSource(next, opts) {
      commitSource(next, { recordHistory: opts?.recordHistory ?? true });
    },

    setProjectName(name) {
      const { project } = get();
      if (!project) return;
      const renamed = { ...project, name: name.trim() || "Untitled", updatedAt: new Date().toISOString() };
      set({ project: renamed });
      persist(renamed);
    },

    select(id) {
      const { scene, selectedId, collapsed } = get();
      const next = id && scene && !scene.byId[id] ? null : id;
      if (next === selectedId) return;
      // A layer picked on the canvas may sit inside a collapsed group: open its ancestors so the row is visible.
      const hiddenAncestors = next && scene ? ancestorIds(scene.byId, next).filter((ancestor) => collapsed[ancestor]) : [];
      if (hiddenAncestors.length === 0) {
        set({ selectedId: next });
        return;
      }
      const opened = { ...collapsed };
      for (const ancestor of hiddenAncestors) opened[ancestor] = false;
      set({ selectedId: next, collapsed: opened });
    },

    seek(t) {
      set({ time: clamp(Number.isFinite(t) ? t : 0, 0, durationOf()) });
    },

    play() {
      const duration = durationOf();
      if (duration <= 0) return;
      const { time } = get();
      set({ playing: true, time: time >= duration ? 0 : time });
      startLoop();
    },

    pause() {
      stopLoop();
      set({ playing: false });
    },

    togglePlay() {
      if (get().playing) get().pause();
      else get().play();
    },

    toggleLoop() {
      set((state) => ({ loop: !state.loop }));
    },

    stepFrames(frames) {
      const fps = fpsOf();
      const { time } = get();
      get().pause();
      get().seek(snapToFrame(Math.round(time * fps) / fps + frames / fps, fps));
    },

    stepSeconds(seconds) {
      const { time } = get();
      get().pause();
      get().seek(snapToFrame(time + seconds, fpsOf()));
    },

    deleteLayer(id) {
      if (!guardUnlocked(id)) return;
      const parentId = get().scene?.byId[id]?.parentId ?? null;
      tryEdit(
        (source) => parserDeleteLayer(source, id),
        () => {
          if (get().selectedId === id) set({ selectedId: parentId });
        },
      );
    },

    duplicateLayer(id) {
      const { project } = get();
      if (!project) return;
      try {
        const { source, newId } = parserDuplicateLayer(entrySource(project), id);
        commitSource(source, { recordHistory: true });
        set({ selectedId: newId });
      } catch (error) {
        set({ notice: { kind: "error", message: errorMessage(error) } });
      }
    },

    moveLayer(id, move) {
      if (!guardUnlocked(id)) return;
      tryEdit((source) => parserMoveLayer(source, id, move));
    },

    setTiming(id, timing) {
      if (!guardUnlocked(id)) return;
      const fps = fpsOf();
      const snapped = {
        start: timing.start === undefined ? undefined : Math.max(0, snapToFrame(timing.start, fps)),
        end: timing.end === undefined ? undefined : Math.max(0, snapToFrame(timing.end, fps)),
      };
      tryEdit((source) => setLayerTiming(source, id, snapped));
    },

    setHidden(id, hidden) {
      tryEdit((source) => setLayerHidden(source, id, hidden));
    },

    setLocked(id, locked) {
      tryEdit((source) => setLayerLocked(source, id, locked));
    },

    renameLayer(id, name) {
      tryEdit((source) => setLayerName(source, id, name));
    },

    wrapInSprite(id, start, end) {
      if (!guardUnlocked(id)) return;
      const { project } = get();
      if (!project) return;
      try {
        const fps = fpsOf();
        const { source, spriteId } = parserWrapInSprite(
          ensureSpriteImport(entrySource(project)),
          id,
          snapToFrame(start, fps),
          snapToFrame(end, fps),
        );
        commitSource(source, { recordHistory: true });
        set({ selectedId: spriteId });
      } catch (error) {
        set({ notice: { kind: "error", message: errorMessage(error) } });
      }
    },

    insertLayer(parentId, jsx, index) {
      const { project } = get();
      if (!project) throw new Error("No project loaded");
      const { source, id } = parserInsertLayer(entrySource(project), parentId, jsx, index);
      commitSource(source, { recordHistory: true });
      set({ selectedId: id });
      return id;
    },

    replaceLayer(id, jsx) {
      const { project, scene } = get();
      if (!project) throw new Error("No project loaded");
      const node = scene?.byId[id];
      if (node?.locked) throw new Error(`"${node.name}" is locked. Unlock it to edit.`);
      commitSource(replaceLayerSource(entrySource(project), id, jsx), { recordHistory: true });
    },

    setStageMeta(meta) {
      tryEdit((source) => parserSetStageMeta(source, meta));
    },

    addTextLayer() {
      const { scene, time } = get();
      if (!scene) return;
      try {
        insertTemplate(textLayerTemplate(clipAtPlayhead(time, scene.meta.duration, scene.meta.fps), scene.meta));
      } catch (error) {
        set({ notice: { kind: "error", message: errorMessage(error) } });
      }
    },

    addShapeLayer(kind) {
      const { scene, time } = get();
      if (!scene) return;
      try {
        insertTemplate(shapeLayerTemplate(clipAtPlayhead(time, scene.meta.duration, scene.meta.fps), kind, scene.meta));
      } catch (error) {
        set({ notice: { kind: "error", message: errorMessage(error) } });
      }
    },

    async addImageLayer(file) {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const { project, scene, time } = get();
        if (!project || !scene) return;
        const path = assetPathFor(file.name, Object.keys(project.files));
        const asset: ProjectFile = { path, kind: "asset", content: dataUrl };
        const withAsset: Project = { ...project, files: { ...project.files, [path]: asset } };
        const timing = clipAtPlayhead(time, scene.meta.duration, scene.meta.fps);
        insertTemplate(imageLayerTemplate(timing, path, file.name), withAsset);
      } catch (error) {
        set({ notice: { kind: "error", message: errorMessage(error) } });
      }
    },

    undo() {
      const { history, project } = get();
      if (!project || history.past.length === 0) return;
      const previous = history.past[history.past.length - 1];
      applySnapshot(previous, {
        past: history.past.slice(0, -1),
        future: [entrySource(project), ...history.future],
      });
    },

    redo() {
      const { history, project } = get();
      if (!project || history.future.length === 0) return;
      const [next, ...future] = history.future;
      applySnapshot(next, { past: [...history.past, entrySource(project)], future });
    },

    updateFile(path, content) {
      const { project } = get();
      if (!project) return;
      if (path === project.entry) {
        get().setSource(content);
        return;
      }
      const existing = project.files[path];
      const file: ProjectFile = existing ? { ...existing, content } : { path, kind: kindForPath(path), content };
      const next: Project = { ...project, files: { ...project.files, [path]: file }, updatedAt: new Date().toISOString() };
      set((state) => ({ project: next, filesRevision: state.filesRevision + 1 }));
      persist(next);
    },

    addFile(file) {
      const { project } = get();
      if (!project) return;
      const next: Project = { ...project, files: { ...project.files, [file.path]: file }, updatedAt: new Date().toISOString() };
      set((state) => ({ project: next, filesRevision: state.filesRevision + 1 }));
      persist(next);
    },

    removeFile(path) {
      const { project } = get();
      if (!project || path === project.entry || !(path in project.files)) return;
      const files = { ...project.files };
      delete files[path];
      const next: Project = { ...project, files, updatedAt: new Date().toISOString() };
      set((state) => ({ project: next, filesRevision: state.filesRevision + 1 }));
      persist(next);
    },

    toggleCollapsed(id) {
      set((state) => ({ collapsed: { ...state.collapsed, [id]: !state.collapsed[id] } }));
    },

    setPreviewReady(ready) {
      set({ previewReady: ready });
    },

    setPreviewError(message, detail = null) {
      set({ previewError: message, previewErrorDetail: message ? detail : null });
    },

    setLayerRects(rects) {
      set({ layerRects: rects });
    },

    setNotice(notice) {
      set({ notice });
    },

    appendChat(key, entry) {
      const full: ChatEntry = { ...entry, id: nanoid(8), at: Date.now() };
      set((state) => ({ chat: { ...state.chat, [key]: [...(state.chat[key] ?? []), full] } }));
      return full;
    },

    clearChat(key) {
      set((state) => {
        const chat = { ...state.chat };
        delete chat[key];
        return { chat };
      });
    },
  };
});

function kindForPath(path: string): ProjectFile["kind"] {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "jsx":
    case "js":
    case "tsx":
    case "ts":
    case "css":
    case "html":
    case "json":
      return ext;
    default:
      return "asset";
  }
}

/** Write any pending autosave immediately (called from the editor on pagehide). */
export function flushAutosave(): void {
  autosaver.flush();
}

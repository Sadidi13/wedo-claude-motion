/**
 * Client state of the storyboard view (docs/STORYBOARD.md): which board is
 * open and its latest copy. The board view polls the open board; useBridgeSync
 * opens it when Claude delivers a step (a "board" event), the Ask Claude tab
 * when the designer starts a new video, the top bar's Storyboard button on demand.
 */
import { create } from "zustand";
import type { Board, StageMeta } from "@/lib/types";

/** Body of POST /api/bridge/boards/[id] (mirrors BoardActionSchema on the server). */
export type BoardActionBody =
  | { action: "choose-style"; styleId: string; note?: string }
  | { action: "restyle"; note?: string }
  | { action: "revise-storyboard"; note: string }
  | { action: "approve"; note?: string };

interface BoardState {
  openId: string | null;
  board: Board | null;
  /** last error from fetching or acting on the board, shown in the view */
  error: string | null;
  /** an action is on its way to the server */
  busy: boolean;
  open(id: string): void;
  close(): void;
  refresh(): Promise<void>;
  act(body: BoardActionBody): Promise<boolean>;
  /** start a new video from a brief (and reference files): an empty board waiting for Claude's style frames */
  start(brief: string, stage: StageMeta, references?: File[]): Promise<boolean>;
  /** attach reference images / videos to the open board */
  addReferences(files: File[]): Promise<boolean>;
}

/** Limits that mirror the server (references.ts): 4 files, 40 MB each. */
export const MAX_REFERENCE_FILES = 4;
export const MAX_REFERENCE_MB = 40;
const REFERENCE_TYPES = /^(image\/(png|jpeg|webp|gif)|video\/(mp4|quicktime|webm|x-m4v|x-matroska))$/;

/** Check reference files before upload; returns an error message or null. */
export function checkReferenceFiles(files: File[], already = 0): string | null {
  if (files.length + already > MAX_REFERENCE_FILES) return `At most ${MAX_REFERENCE_FILES} references per storyboard`;
  for (const file of files) {
    if (!REFERENCE_TYPES.test(file.type)) return `"${file.name}" is not a supported image or video (png, jpg, webp, gif, mp4, mov, webm)`;
    if (file.size > MAX_REFERENCE_MB * 1024 * 1024) return `"${file.name}" is larger than ${MAX_REFERENCE_MB} MB`;
  }
  return null;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function encodeReferences(files: File[]): Promise<{ name: string; dataUrl: string }[]> {
  return Promise.all(files.map(async (file) => ({ name: file.name, dataUrl: await readAsDataUrl(file) })));
}

const BOARD_ID = /^[0-9a-z]{15}$/;

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `HTTP ${response.status}`;
}

export const useBoardStore = create<BoardState>()((set, get) => ({
  async addReferences(files) {
    const id = get().openId;
    if (!id || files.length === 0) return false;
    set({ busy: true, error: null });
    try {
      const response = await fetch(`/api/bridge/boards/${id}/references`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ references: await encodeReferences(files) }),
      });
      if (!response.ok) {
        set({ error: await readError(response) });
        return false;
      }
      const { board } = (await response.json()) as { board: Board };
      if (get().openId === id) set({ board });
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  openId: null,
  board: null,
  error: null,
  busy: false,

  open(id) {
    if (!BOARD_ID.test(id)) return;
    if (get().openId !== id) set({ openId: id, board: get().board?.id === id ? get().board : null, error: null });
    void get().refresh();
  },

  close() {
    set({ openId: null, error: null });
  },

  async refresh() {
    const id = get().openId;
    if (!id) return;
    try {
      const response = await fetch(`/api/bridge/boards/${id}`, { cache: "no-store" });
      if (get().openId !== id) return;
      if (!response.ok) {
        set({ error: await readError(response) });
        return;
      }
      const board = (await response.json()) as Board;
      // Keep the same object while nothing changed, so the frames do not reload.
      const current = get().board;
      if (current && current.id === board.id && current.updatedAt === board.updatedAt) return;
      set({ board, error: null });
    } catch {
      // server restarting: the next poll tries again
    }
  },

  async act(body) {
    const id = get().openId;
    if (!id || get().busy) return false;
    set({ busy: true, error: null });
    try {
      const response = await fetch(`/api/bridge/boards/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        set({ error: await readError(response) });
        return false;
      }
      const { board } = (await response.json()) as { board: Board };
      if (get().openId === id) set({ board });
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  async start(brief, stage, references = []) {
    set({ busy: true, error: null });
    try {
      const response = await fetch("/api/bridge/boards/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brief,
          stage: { width: stage.width, height: stage.height, duration: stage.duration, fps: stage.fps, background: stage.background },
          ...(references.length ? { references: await encodeReferences(references) } : {}),
        }),
      });
      if (!response.ok) {
        set({ error: await readError(response) });
        return false;
      }
      const { board } = (await response.json()) as { board: Board };
      set({ openId: board.id, board });
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      set({ busy: false });
    }
  },
}));

/**
 * localStorage autosave for the editor (CONTRACTS §4):
 *
 *   motion-studio:project:<id>  JSON of the Project
 *   motion-studio:last          id of the project to reopen on next visit
 *
 * Every storage access is wrapped in try/catch (private mode, quota, SSR) and
 * the serialisation helpers are pure so they can be unit-tested without a DOM.
 * `createAutosaver` debounces writes (500ms) and always keeps the newest project.
 */
import type { Project } from "@/lib/types";

export const LAST_PROJECT_KEY = "motion-studio:last";
export const AUTOSAVE_DELAY_MS = 500;

export function projectStorageKey(id: string): string {
  return `motion-studio:project:${id}`;
}

/** Minimal subset of `Storage` the helpers need (lets tests pass a Map-backed fake). */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Structural check for a Project read back from storage (ignores unknown extra keys). */
export function isProjectShape(value: unknown): value is Project {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || !value.id || typeof value.name !== "string") return false;
  if (typeof value.entry !== "string" || !isRecord(value.files) || !isRecord(value.meta)) return false;
  const meta = value.meta;
  if (!isFiniteNumber(meta.width) || !isFiniteNumber(meta.height) || !isFiniteNumber(meta.duration) || !isFiniteNumber(meta.fps)) {
    return false;
  }
  if (typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") return false;
  return Object.values(value.files).every(
    (file) => isRecord(file) && typeof file.path === "string" && typeof file.kind === "string" && typeof file.content === "string",
  );
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project);
}

/** Parse a stored record; null for malformed JSON or a wrong shape. */
export function deserializeProject(raw: string | null | undefined): Project | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isProjectShape(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Write the project and mark it as the last one opened. Returns false when storage is unavailable / full. */
export function saveProject(project: Project, storage: StorageLike | undefined = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(projectStorageKey(project.id), serializeProject(project));
    storage.setItem(LAST_PROJECT_KEY, project.id);
    return true;
  } catch (error) {
    console.warn("[motion-studio] autosave failed:", error);
    return false;
  }
}

export function readProject(id: string, storage: StorageLike | undefined = defaultStorage()): Project | null {
  if (!storage) return null;
  try {
    return deserializeProject(storage.getItem(projectStorageKey(id)));
  } catch {
    return null;
  }
}

/** The project to reopen on first visit, or null. */
export function readLastProject(storage: StorageLike | undefined = defaultStorage()): Project | null {
  if (!storage) return null;
  try {
    const id = storage.getItem(LAST_PROJECT_KEY);
    return id ? readProject(id, storage) : null;
  } catch {
    return null;
  }
}

export interface Autosaver {
  /** queue a save; later calls within the delay replace the pending project */
  schedule(project: Project): void;
  /** write the pending project now (used before unload) */
  flush(): void;
  cancel(): void;
}

export function createAutosaver(
  save: (project: Project) => void = (p) => void saveProject(p),
  delayMs = AUTOSAVE_DELAY_MS,
): Autosaver {
  let pending: Project | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!pending) return;
    const project = pending;
    pending = null;
    save(project);
  };
  return {
    schedule(project) {
      pending = project;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    flush,
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}

/**
 * Standalone mode only: when /preview is opened directly (no editor, no
 * ?job=) it plays the project the editor last autosaved to localStorage
 * (keys defined by the store contract, CONTRACTS.md §4).
 */

import type { Project } from "@/lib/types";
import { isProjectLike } from "./guards";

export const LAST_PROJECT_KEY = "motion-studio:last";

export function projectStorageKey(id: string): string {
  return `motion-studio:project:${id}`;
}

export function readLastProject(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): Project | null {
  try {
    if (!storage) return null;
    const id = storage.getItem(LAST_PROJECT_KEY);
    if (!id) return null;
    const raw = storage.getItem(projectStorageKey(id));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isProjectLike(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

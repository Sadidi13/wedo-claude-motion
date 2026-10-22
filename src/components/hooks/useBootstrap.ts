"use client";
/**
 * First-load behaviour (CONTRACTS §4): reopen the last autosaved project from
 * localStorage, else load the first bundled sample (with a fresh id so the
 * sample itself is never overwritten). Also flushes a pending autosave when
 * the tab is hidden / closed. Runs once, client-side only.
 */
import { nanoid } from "nanoid";
import { useEffect } from "react";
import type { Project } from "@/lib/types";
import { samples } from "@/samples";
import { flushAutosave, useEditorStore } from "@/store/editorStore";
import { readLastProject } from "@/store/persistence";

/** A fresh copy of a sample / template project that will not collide with saved ones. */
export function instantiateProject(project: Project, origin: Project["origin"] = "sample"): Project {
  const now = new Date().toISOString();
  return { ...project, id: nanoid(10), createdAt: now, updatedAt: now, origin };
}

export function useBootstrap(): void {
  useEffect(() => {
    const store = useEditorStore.getState();
    if (!store.project) {
      const saved = readLastProject();
      const first = samples[0]?.project;
      if (saved) store.loadProject(saved);
      else if (first) store.loadProject(instantiateProject(first));
      else store.newBlankProject();
    }
    const flush = () => flushAutosave();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, []);
}

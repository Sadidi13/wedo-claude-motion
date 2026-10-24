/**
 * Version history (docs/VERSIONS.md): named snapshots of a project's code,
 * kept in this browser's IndexedDB (assets are left out: they rarely change and
 * would fill the storage). Every change Claude makes saves one, and the
 * designer can save one by hand; restoring is an ordinary, undoable edit.
 * Without IndexedDB (private windows of some browsers) versions live in memory
 * for the session.
 */
import { nanoid } from "nanoid";
import type { Project } from "@/lib/types";

export interface ProjectVersion {
  id: string;
  projectId: string;
  /** epoch ms */
  at: number;
  label: string;
  /** text files only (entry included); assets are not versioned */
  files: Record<string, { path: string; kind: Project["files"][string]["kind"]; content: string }>;
  entry: string;
}

/** Versions kept per project; older ones are dropped. */
export const MAX_VERSIONS = 60;
const DB_NAME = "motion-studio-versions";
const STORE = "versions";

let memory: ProjectVersion[] = [];
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("projectId", "projectId");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function all(projectId: string): Promise<ProjectVersion[]> {
  const db = await openDb();
  if (!db) return memory.filter((version) => version.projectId === projectId);
  const index = db.transaction(STORE, "readonly").objectStore(STORE).index("projectId");
  return done(index.getAll(projectId) as IDBRequest<ProjectVersion[]>);
}

/** Newest first. */
export async function listVersions(projectId: string): Promise<ProjectVersion[]> {
  try {
    return (await all(projectId)).sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

/** Save the project's current code as a version (skipped when it equals the newest one). */
export async function saveVersion(project: Project, label: string): Promise<ProjectVersion | null> {
  const files: ProjectVersion["files"] = {};
  for (const [path, file] of Object.entries(project.files)) {
    if (file.kind !== "asset") files[path] = { path: file.path, kind: file.kind, content: file.content };
  }
  const version: ProjectVersion = { id: nanoid(12), projectId: project.id, at: Date.now(), label: label.slice(0, 200), files, entry: project.entry };
  try {
    const existing = await listVersions(project.id);
    const newest = existing[0];
    if (newest && newest.files[newest.entry]?.content === files[project.entry]?.content && JSON.stringify(newest.files) === JSON.stringify(files)) {
      return null;
    }
    const db = await openDb();
    if (!db) {
      memory = [...memory, version];
    } else {
      const store = db.transaction(STORE, "readwrite").objectStore(STORE);
      await done(store.put(version));
    }
    for (const old of existing.slice(MAX_VERSIONS - 1)) await removeVersion(old.id);
    return version;
  } catch {
    return null;
  }
}

async function removeVersion(id: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    memory = memory.filter((version) => version.id !== id);
    return;
  }
  await done(db.transaction(STORE, "readwrite").objectStore(STORE).delete(id));
}

/** The project with a version's text files put back (assets untouched). */
export function projectAtVersion(project: Project, version: ProjectVersion): Project {
  const files = { ...project.files };
  for (const [path, file] of Object.entries(project.files)) if (file.kind !== "asset" && !version.files[path]) delete files[path];
  for (const [path, file] of Object.entries(version.files)) files[path] = { ...file };
  return { ...project, files, entry: version.entry, updatedAt: new Date().toISOString() };
}

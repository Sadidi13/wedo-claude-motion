/**
 * Click-to-select: given a pointer event's composed path (deepest element
 * first) find the first `[data-layer-id]` before reaching the stage element.
 * Returns null for empty stage area. Typed loosely so it can be unit-tested
 * with plain objects instead of a DOM.
 */

export interface PathNode {
  getAttribute?: (name: string) => string | null;
}

export function findLayerIdInPath(path: readonly unknown[], stage: unknown): string | null {
  for (const node of path) {
    if (node === stage) return null;
    const el = node as PathNode;
    if (typeof el?.getAttribute !== "function") continue;
    const id = el.getAttribute("data-layer-id");
    if (id) return id;
  }
  return null;
}

/**
 * Flattens the layer tree into the row list shared by the Layers panel and
 * the Timeline, honouring collapsed groups.
 *
 * Order is "After Effects style": the LAST child of a parent (drawn on top in
 * the DOM) is the FIRST row, so what is visually on top of the canvas sits at
 * the top of the panel. Children follow their parent, each group reversed the
 * same way. The parser keeps source order, so the panel's "bring forward" is
 * the parser's `direction: "down"` (swap with the next sibling) and vice
 * versa — see `sourceDirectionFor`.
 */
import type { LayerNode } from "@/lib/types";

export interface LayerRow {
  node: LayerNode;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
}

export function flattenLayers(layers: readonly LayerNode[], collapsed: Readonly<Record<string, boolean>>): LayerRow[] {
  const rows: LayerRow[] = [];
  const visit = (nodes: readonly LayerNode[]) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      const isCollapsed = Boolean(collapsed[node.id]);
      rows.push({ node, depth: node.depth, hasChildren: node.children.length > 0, collapsed: isCollapsed });
      if (!isCollapsed) visit(node.children);
    }
  };
  visit(layers);
  return rows;
}

/** Panel direction ("up" = towards the top of the panel = drawn later) → parser direction. */
export function sourceDirectionFor(panelDirection: "up" | "down"): "up" | "down" {
  return panelDirection === "up" ? "down" : "up";
}

/** True for a `<Sprite>` whose start AND end are numeric literals (editable from the timeline). */
export function hasLiteralTiming(node: LayerNode): boolean {
  return node.kind === "sprite" && node.start !== undefined && node.end !== undefined;
}

/** Every ancestor id of `id`, nearest first. */
export function ancestorIds(byId: Readonly<Record<string, LayerNode>>, id: string): string[] {
  const out: string[] = [];
  let current = byId[id]?.parentId ?? null;
  while (current) {
    out.push(current);
    current = byId[current]?.parentId ?? null;
  }
  return out;
}

/** The time window a clip may be dragged inside: its parent's range (the Stage for top-level layers). */
export function dragBoundsFor(
  byId: Readonly<Record<string, LayerNode>>,
  node: LayerNode,
  duration: number,
): { start: number; end: number } {
  const parent = node.parentId ? byId[node.parentId] : undefined;
  if (!parent) return { start: 0, end: duration };
  return { start: parent.range.start, end: Math.min(parent.range.end, duration) };
}

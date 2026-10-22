/**
 * Structural layer operations (CONTRACTS §2): read, replace, delete,
 * duplicate, insert and move layers, plus listLayerIds. Every operation
 * re-parses the file, computes offset-based splices and leaves the rest of
 * the source byte-identical.
 */
import { ATTR, afterLayerId, attrString, findAttr, setAttrEdit } from "./attrs";
import { span } from "./babel";
import { ensureLayerIds, idEditsFor } from "./ensureIds";
import { parseLayerFragment } from "./fragment";
import { insertionEdit, removalEdit, swapSpans } from "./layout";
import { buildScene } from "./scene";
import { collectAllIds, elementId, findElement, isWithin, loadStage } from "./stage";
import { applyEdits, eolOf, escapeJsxAttr, indentAt, reindent } from "./text";

/** How `moveLayer` moves: swap with a sibling, or re-parent at an index (parentId null = Stage). */
export type LayerMove = { direction: "up" | "down" } | { parentId: string | null; index: number };

/** Exact JSX text of the element with that id (opening tag through closing tag). */
export function getLayerSource(source: string, id: string): string {
  const ctx = loadStage(source);
  const s = span(findElement(ctx, id).node);
  return source.slice(s.start, s.end);
}

/**
 * Replace a layer with new JSX. `jsx` must be exactly one element; its
 * `data-layer-id` is forced to `id`, nested elements keep their ids when they
 * are still unique and get fresh ones otherwise, and the replacement is
 * re-indented to the original element's line.
 */
export function replaceLayerSource(source: string, id: string, jsx: string): string {
  const ctx = loadStage(source);
  const el = findElement(ctx, id);
  const s = span(el.node);
  const fragment = parseLayerFragment(jsx);

  // ids used elsewhere in the file; ids inside the element being replaced are free to reuse
  const taken = collectAllIds(ctx.ast);
  for (const inner of ctx.elements) {
    if (!isWithin(inner, el)) continue;
    const innerId = elementId(inner);
    if (innerId) taken.delete(innerId);
  }
  const { edits } = idEditsFor(fragment.elements, taken, { forceRootId: id, avoid: new Set(taken) });
  const replacement = reindent(applyEdits(fragment.text, edits), indentAt(source, s.start), eolOf(source));
  const next = source.slice(0, s.start) + replacement + source.slice(s.end);
  return ensureLayerIds(next).source;
}

/** Remove a layer (and its subtree) from the source. */
export function deleteLayer(source: string, id: string): string {
  const ctx = loadStage(source);
  return applyEdits(source, [removalEdit(source, findElement(ctx, id))]);
}

/**
 * Insert a copy of the layer right after it. Every id inside the copy is
 * regenerated and its name gets " copy". A layer that is not a plain JSX
 * child (e.g. the body of a function-child) is duplicated inside a fragment
 * so the surrounding expression stays valid.
 */
export function duplicateLayer(source: string, id: string): { source: string; newId: string } {
  const ctx = loadStage(source);
  const el = findElement(ctx, id);
  const s = span(el.node);
  const original = source.slice(s.start, s.end);
  const derivedName = buildScene(ctx).byId[id]?.name ?? `<${el.tag}>`;

  const fragment = parseLayerFragment(original);
  const { edits, ids } = idEditsFor(fragment.elements, collectAllIds(ctx.ast), { regenerateAll: true });
  const baseName = attrString(findAttr(fragment.root.node, ATTR.name)) ?? derivedName;
  edits.push(
    setAttrEdit(fragment.root.node, ATTR.name, `"${escapeJsxAttr(`${baseName} copy`)}"`, afterLayerId(fragment.root.node)),
  );

  const eol = eolOf(source);
  const indent = indentAt(source, s.start);
  const copy = reindent(applyEdits(fragment.text, edits), indent, eol);
  const next = el.directChild
    ? source.slice(0, s.end) + eol + indent + copy + source.slice(s.end)
    : source.slice(0, s.start) + `<>${original}${eol}${indent}${copy}</>` + source.slice(s.end);
  return { source: next, newId: ids[0] };
}

/**
 * Insert new JSX as a child of `parentId` (null = the Stage) at `index`
 * among its layer children (undefined = append). Elements in the fragment
 * get ids unless they already carry unused ones.
 */
export function insertLayer(
  source: string,
  parentId: string | null,
  jsx: string,
  index?: number,
): { source: string; id: string } {
  const ctx = loadStage(source);
  const parent = parentId === null ? null : findElement(ctx, parentId);
  const fragment = parseLayerFragment(jsx);
  const taken = collectAllIds(ctx.ast);
  const { edits, ids } = idEditsFor(fragment.elements, taken, { avoid: new Set(taken) });
  const text = applyEdits(fragment.text, edits);
  const next = applyEdits(source, [insertionEdit(ctx, parent, text, index)]);
  return { source: next, id: ids[0] };
}

/**
 * Move a layer. `direction` swaps it with its previous / next sibling layer
 * (no-op at the edges). `{ parentId, index }` removes it and inserts it into
 * the new parent; `index` counts the parent's layer children after the
 * removal.
 */
export function moveLayer(source: string, id: string, move: LayerMove): string {
  const ctx = loadStage(source);
  const el = findElement(ctx, id);

  if ("direction" in move) {
    const siblings = ctx.elements.filter((e) => e.parent === el.parent);
    const i = siblings.indexOf(el);
    const j = move.direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= siblings.length) return source;
    const other = siblings[j];
    // Swapping raw spans is only safe between plain JSX children of the same
    // container. A sibling rendered inside an expression (a .map() callback, a
    // `cond && …` branch, a ternary arm) would be torn out of its scope.
    if (!el.directChild || !other.directChild) {
      throw new Error(
        `Layer "${id}" cannot be reordered here: it or its neighbour is rendered inside an expression (.map(), condition). Edit the code instead.`,
      );
    }
    return swapSpans(source, span(el.node), span(other.node));
  }

  if (move.parentId !== null) {
    const target = findElement(ctx, move.parentId);
    if (isWithin(target, el)) throw new Error(`Cannot move layer "${id}" into itself`);
  }
  const s = span(el.node);
  const text = source.slice(s.start, s.end);
  const removed = applyEdits(source, [removalEdit(source, el)]);

  const ctx2 = loadStage(removed);
  const parent = move.parentId === null ? null : findElement(ctx2, move.parentId);
  return applyEdits(removed, [insertionEdit(ctx2, parent, text, move.index)]);
}

/** Ids of every layer inside the Stage, in source order (elements without an id are skipped). */
export function listLayerIds(source: string): string[] {
  const ids: string[] = [];
  for (const el of loadStage(source).elements) {
    const id = elementId(el);
    if (id) ids.push(id);
  }
  return ids;
}

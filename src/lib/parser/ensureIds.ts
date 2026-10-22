/**
 * Giving every layer element a unique `data-layer-id`.
 *
 * `ensureLayerIds` is idempotent: it only touches elements inside the Stage
 * subtree that have no literal id, or whose id duplicates an earlier one. The
 * attribute is inserted right after the tag name. `idEditsFor` is the shared
 * core, also used to stamp ids onto fragments that are about to be inserted
 * (replace / insert / duplicate), where the root id may be forced or every id
 * regenerated.
 */
import { ATTR, afterTagName, attrString, findAttr } from "./attrs";
import { span } from "./babel";
import { generateLayerId } from "./ids";
import { type WalkedElement, collectAllIds, loadStage } from "./stage";
import { type TextEdit, applyEdits } from "./text";

export interface IdAssignOptions {
  /** id to force onto `elements[0]` (the fragment root) */
  forceRootId?: string;
  /** regenerate every id, even valid ones (duplicateLayer) */
  regenerateAll?: boolean;
  /** ids that already exist elsewhere and must not be reused by these elements */
  avoid?: ReadonlySet<string>;
}

export interface IdAssignment {
  edits: TextEdit[];
  /** final id of each element, parallel to the input array */
  ids: string[];
}

/**
 * Compute the edits that give each element a unique id. `taken` is the pool
 * used to generate fresh ids (it grows as ids are generated).
 */
export function idEditsFor(
  elements: readonly WalkedElement[],
  taken: Set<string>,
  options: IdAssignOptions = {},
): IdAssignment {
  const seen = new Set<string>();
  const edits: TextEdit[] = [];
  const ids: string[] = [];

  elements.forEach((el, index) => {
    const attr = findAttr(el.node, ATTR.id);
    const current = attrString(attr) || undefined;
    let next: string | undefined;

    if (index === 0 && options.forceRootId !== undefined) {
      if (current !== options.forceRootId) next = options.forceRootId;
      seen.add(options.forceRootId);
      taken.add(options.forceRootId);
    } else if (
      options.regenerateAll ||
      current === undefined ||
      seen.has(current) ||
      options.avoid?.has(current)
    ) {
      next = generateLayerId(el.tag, taken);
    }

    const finalId = next ?? (current as string);
    seen.add(finalId);
    taken.add(finalId);
    ids.push(finalId);
    if (next === undefined) return;

    if (attr) {
      if (attr.value) {
        const s = span(attr.value);
        edits.push({ start: s.start, end: s.end, text: `"${next}"` });
      } else {
        const end = span(attr).end;
        edits.push({ start: end, end, text: `="${next}"` });
      }
    } else {
      const at = afterTagName(el.node);
      edits.push({ start: at, end: at, text: ` ${ATTR.id}="${next}"` });
    }
  });

  return { edits, ids };
}

/** Add a `data-layer-id` to every element inside <Stage> that lacks one (or duplicates another). */
export function ensureLayerIds(source: string): { source: string; changed: boolean } {
  const ctx = loadStage(source);
  const { edits } = idEditsFor(ctx.elements, collectAllIds(ctx.ast));
  if (edits.length === 0) return { source, changed: false };
  return { source: applyEdits(source, edits), changed: true };
}

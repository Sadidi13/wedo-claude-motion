/**
 * Per-layer attribute operations (CONTRACTS §2): Sprite timing, wrapping a
 * layer in a Sprite, hidden / locked flags and the display name. Each one is
 * a minimal splice inside the element's opening tag (or around the element
 * for wrapInSprite).
 */
import { type MotionSpec, serializeMotion } from "@/lib/motion/keyframes";
import { ATTR, afterLayerId, afterTagName, attrIsTrue, findAttr, removeAttrEdit, setAttrEdit } from "./attrs";
import { span } from "./babel";
import { generateLayerId } from "./ids";
import { detectIndentUnit } from "./layout";
import { buildScene } from "./scene";
import { collectAllIds, findElement, isTimedTag, loadStage } from "./stage";
import { type TextEdit, applyEdits, eolOf, escapeJsxAttr, formatNumber, indentAt, reindent, splice } from "./text";

/**
 * Write `start={n}` / `end={n}` on a Sprite as numeric literals (3 decimals
 * max, no trailing zeros), adding the attribute when absent. Throws for
 * non-Sprite layers: wrap them first.
 */
export function setLayerTiming(source: string, id: string, timing: { start?: number; end?: number }): string {
  const ctx = loadStage(source);
  const el = findElement(ctx, id);
  if (!isTimedTag(el.tag)) throw new Error(`Layer ${id} is not a Sprite; wrap it first`);

  const startAttr = findAttr(el.node, "start");
  const endAttr = findAttr(el.node, "end");
  const edits: TextEdit[] = [];

  if (timing.start !== undefined) {
    const raw = `{${formatNumber(timing.start)}}`;
    if (startAttr) {
      edits.push(setAttrEdit(el.node, "start", raw));
    } else if (endAttr) {
      // keep `start` before `end`: insert it right before the existing end attribute
      const at = span(endAttr).start;
      edits.push({ start: at, end: at, text: `start=${raw} ` });
    } else {
      edits.push(setAttrEdit(el.node, "start", raw, afterTagName(el.node)));
    }
  }
  if (timing.end !== undefined) {
    const raw = `{${formatNumber(timing.end)}}`;
    if (endAttr) {
      edits.push(setAttrEdit(el.node, "end", raw));
    } else {
      edits.push(setAttrEdit(el.node, "end", raw, startAttr ? span(startAttr).end : afterTagName(el.node)));
    }
  }
  return edits.length ? applyEdits(source, edits) : source;
}

/**
 * Wrap a layer in `<Sprite start end data-layer-id data-layer-name>` so it
 * can be retimed. The new Sprite takes the layer's display name; the wrapped
 * element keeps its own id and is indented one level deeper.
 */
export function wrapInSprite(
  source: string,
  id: string,
  start: number,
  end: number,
): { source: string; spriteId: string } {
  const ctx = loadStage(source);
  const el = findElement(ctx, id);
  const name = buildScene(ctx).byId[id]?.name ?? `<${el.tag}>`;
  const spriteId = generateLayerId("Sprite", collectAllIds(ctx.ast));

  const s = span(el.node);
  const eol = eolOf(source);
  const indent = indentAt(source, s.start);
  const unit = detectIndentUnit(ctx);
  const inner = reindent(source.slice(s.start, s.end), indent + unit, eol);
  const wrapped =
    `<Sprite start={${formatNumber(start)}} end={${formatNumber(end)}} ` +
    `${ATTR.id}="${spriteId}" ${ATTR.name}="${escapeJsxAttr(name)}">` +
    `${eol}${indent}${unit}${inner}${eol}${indent}</Sprite>`;
  return { source: splice(source, s.start, s.end, wrapped), spriteId };
}

/**
 * Set one prop of a layer to a literal (`{0.8}`, `"text"`, a bare `loop` for true) or remove it
 * (`null`, and `false` for flags). Used by the inspector for <Audio> volume, fades and loop.
 */
export function setLayerAttribute(source: string, id: string, name: string, value: number | string | boolean | null): string {
  if (!/^[A-Za-z][\w-]*$/.test(name)) throw new Error(`Invalid attribute name "${name}"`);
  const ctx = loadStage(source);
  const el = findElement(ctx, id);
  if (value === null || value === false) {
    const edit = removeAttrEdit(source, el.node, name);
    return edit ? applyEdits(source, [edit]) : source;
  }
  if (value === true) {
    const attr = findAttr(el.node, name);
    if (attr && attrIsTrue(attr)) return source;
    if (attr) {
      const edit = removeAttrEdit(source, el.node, name);
      source = edit ? applyEdits(source, [edit]) : source;
      return setLayerAttribute(source, id, name, true);
    }
    const at = afterTagName(el.node);
    return applyEdits(source, [{ start: at, end: at, text: ` ${name}` }]);
  }
  const raw = typeof value === "number" ? `{${formatNumber(value)}}` : `"${escapeJsxAttr(value)}"`;
  return applyEdits(source, [setAttrEdit(el.node, name, raw)]);
}

/**
 * Write the layer's motion as `data-motion='{…}'` (after data-layer-id), or remove the attribute
 * when `spec` is null or holds nothing but neutral values.
 */
export function setLayerMotion(source: string, id: string, spec: MotionSpec | null): string {
  const ctx = loadStage(source);
  const el = findElement(ctx, id);
  const json = spec ? serializeMotion(spec) : null;
  if (!json) {
    const edit = removeAttrEdit(source, el.node, ATTR.motion);
    return edit ? applyEdits(source, [edit]) : source;
  }
  return applyEdits(source, [setAttrEdit(el.node, ATTR.motion, `'${json}'`, afterLayerId(el.node))]);
}

/** Set or clear a boolean data-* flag (`data-hidden="true"` / `data-locked="true"`). */
function setFlag(source: string, id: string, attrName: string, on: boolean): string {
  const ctx = loadStage(source);
  const el = findElement(ctx, id);
  const attr = findAttr(el.node, attrName);
  if (on) {
    if (attr && attrIsTrue(attr)) return source;
    return applyEdits(source, [setAttrEdit(el.node, attrName, '"true"', afterLayerId(el.node))]);
  }
  const edit = removeAttrEdit(source, el.node, attrName);
  return edit ? applyEdits(source, [edit]) : source;
}

export function setLayerHidden(source: string, id: string, hidden: boolean): string {
  return setFlag(source, id, ATTR.hidden, hidden);
}

export function setLayerLocked(source: string, id: string, locked: boolean): string {
  return setFlag(source, id, ATTR.locked, locked);
}

/** Set `data-layer-name`; an empty name removes the attribute so the derived name shows again. */
export function setLayerName(source: string, id: string, name: string): string {
  const ctx = loadStage(source);
  const el = findElement(ctx, id);
  const trimmed = name.trim();
  if (!trimmed) {
    const edit = removeAttrEdit(source, el.node, ATTR.name);
    return edit ? applyEdits(source, [edit]) : source;
  }
  return applyEdits(source, [setAttrEdit(el.node, ATTR.name, `"${escapeJsxAttr(trimmed)}"`, afterLayerId(el.node))]);
}

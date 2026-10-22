/**
 * setStageMeta: edit or add the literal `width` / `height` / `duration` /
 * `fps` / `background` props on the <Stage> opening element. Existing props
 * have their value replaced in place; missing ones are appended after the
 * last attribute (in the order above). Keys left undefined are untouched.
 */
import type { StageMeta } from "@/lib/types";
import { afterTagName, findAttr, setAttrEdit } from "./attrs";
import { span } from "./babel";
import { loadStage } from "./stage";
import { type TextEdit, applyEdits, escapeJsxAttr, formatNumber } from "./text";

const NUMERIC_KEYS = ["width", "height", "duration", "fps"] as const;

export function setStageMeta(source: string, meta: Partial<StageMeta>): string {
  const ctx = loadStage(source);
  const stage = ctx.stagePath.node;
  const edits: TextEdit[] = [];
  const additions: string[] = [];

  const apply = (key: keyof StageMeta, raw: string): void => {
    if (findAttr(stage, key)) edits.push(setAttrEdit(stage, key, raw));
    else additions.push(` ${key}=${raw}`);
  };

  for (const key of NUMERIC_KEYS) {
    const value = meta[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Stage prop "${key}" must be a finite number`);
    }
    apply(key, `{${formatNumber(value)}}`);
  }
  if (meta.background !== undefined) {
    apply("background", `"${escapeJsxAttr(String(meta.background))}"`);
  }

  if (additions.length) {
    const attrs = stage.openingElement.attributes;
    const at = attrs.length ? span(attrs[attrs.length - 1]).end : afterTagName(stage);
    edits.push({ start: at, end: at, text: additions.join("") });
  }
  return edits.length ? applyEdits(source, edits) : source;
}

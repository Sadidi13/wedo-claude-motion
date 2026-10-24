/**
 * Applies the editor's layer motion (`data-motion`, src/lib/motion/keyframes.ts)
 * to the rendered DOM after every Stage commit, so it shows in the preview and
 * in exports alike (the exporter's `__seek` commits synchronously).
 *
 * It writes only the CSS properties React does not manage in practice — the
 * individual transforms `translate`, `rotate`, `scale` (they compose with the
 * scene's own `transform`) and `transform-origin` when the spec sets one — and
 * multiplies `opacity` with the value the scene's code set, remembering that
 * base so a re-render that leaves React's value unchanged is not multiplied twice.
 *
 * While the designer drags a layer, the editor sends a live spec
 * (`setMotionOverride`) that replaces the attribute until the drag is committed.
 */

import { motionAt, parseMotion, type MotionSpec } from "@/lib/motion/keyframes";
import { getClock } from "./clock";

const parsed = new Map<string, MotionSpec | null>();
const overrides = new Map<string, MotionSpec | null>();
/** Elements this module wrote to, so their styles can be cleared when the attribute goes away. */
let touched = new Set<HTMLElement>();
const opacityBase = new WeakMap<HTMLElement, { written: string; base: string }>();
let lastStage: HTMLElement | null = null;

function specOf(el: HTMLElement): MotionSpec | null {
  const id = el.getAttribute("data-layer-id");
  if (id && overrides.has(id)) return overrides.get(id) ?? null;
  const raw = el.getAttribute("data-motion");
  if (!raw) return null;
  if (!parsed.has(raw)) {
    if (parsed.size > 500) parsed.clear();
    parsed.set(raw, parseMotion(raw));
  }
  return parsed.get(raw) ?? null;
}

/** Start of the Sprite whose clock the keyframes use: the element itself or its nearest Sprite. */
function spriteStart(el: HTMLElement): number {
  const host = el.closest<HTMLElement>("[data-sprite-start]");
  const start = host ? Number(host.getAttribute("data-sprite-start")) : 0;
  return Number.isFinite(start) ? start : 0;
}

function setOpacity(el: HTMLElement, factor: number): void {
  const record = opacityBase.get(el);
  const current = el.style.opacity;
  const base = record && current === record.written ? record.base : current;
  if (factor >= 0.9995) {
    if (record) {
      el.style.opacity = base;
      opacityBase.delete(el);
    }
    return;
  }
  const baseValue = base === "" ? 1 : Number(base);
  const written = String(Math.max(0, (Number.isFinite(baseValue) ? baseValue : 1) * factor));
  el.style.opacity = written;
  opacityBase.set(el, { written: el.style.opacity, base });
}

function clear(el: HTMLElement): void {
  el.style.translate = "";
  el.style.rotate = "";
  el.style.scale = "";
  el.style.transformOrigin = "";
  setOpacity(el, 1);
}

function apply(el: HTMLElement, spec: MotionSpec, time: number): void {
  const values = motionAt(spec, time - spriteStart(el));
  el.style.translate = values.x || values.y ? `${values.x}px ${values.y}px` : "";
  el.style.rotate = values.rotate ? `${values.rotate}deg` : "";
  el.style.scale = values.scale !== 1 ? String(values.scale) : "";
  el.style.transformOrigin = spec.ox !== undefined || spec.oy !== undefined ? `${spec.ox ?? 0}px ${spec.oy ?? 0}px` : "";
  setOpacity(el, values.opacity);
}

/** Apply every layer's motion inside `stage` at stage time `time`. */
export function applyLayerMotion(stage: HTMLElement, time: number): void {
  lastStage = stage;
  const next = new Set<HTMLElement>();
  const candidates = new Set<HTMLElement>(stage.querySelectorAll<HTMLElement>("[data-motion]"));
  for (const id of overrides.keys()) {
    const el = stage.querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(id)}"]`);
    if (el) candidates.add(el);
  }
  for (const el of candidates) {
    const spec = specOf(el);
    if (!spec) continue;
    apply(el, spec, time);
    next.add(el);
  }
  for (const el of touched) if (!next.has(el) && el.isConnected) clear(el);
  touched = next;
}

/** The editor's live preview of a drag (null clears it); re-applies at once. */
export function setMotionOverride(id: string, spec: MotionSpec | null | undefined): void {
  if (spec === undefined) overrides.delete(id);
  else overrides.set(id, spec);
  if (lastStage?.isConnected) applyLayerMotion(lastStage, getClock().time);
}

/** Drop every live override (a new project was loaded). */
export function clearMotionOverrides(): void {
  overrides.clear();
}

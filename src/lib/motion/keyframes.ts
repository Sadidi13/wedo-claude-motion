/**
 * Layer motion set in the editor (docs/TRANSFORM.md): a move / scale / rotate /
 * opacity offset per layer, static or keyframed, stored in the scene as one
 * `data-motion` JSON attribute:
 *
 *   data-motion='{"x":40,"y":-20,"scale":1.2}'
 *   data-motion='{"x":[[0,-120,"easeOutCubic"],[0.6,0]],"opacity":[[0,0],[0.4,1]]}'
 *
 * Keyframe times are seconds from the start of the layer's Sprite (the layer
 * itself when it is a Sprite, else its nearest Sprite ancestor), so moving the
 * clip on the timeline moves its keyframes with it. A keyframe's easing shapes
 * the segment that starts at it. `ox` / `oy` place the transform origin (px
 * from the element's top-left), used for Sprite layers, whose box is the
 * whole stage.
 *
 * The runtime applies the result on top of whatever the scene's own code does
 * (CSS translate / rotate / scale and a multiplied opacity), so it works on any
 * element, including custom components. Pure and isomorphic.
 */

import { Easing, clamp, lerp } from "@/runtime/easing";

export const MOTION_PROPS = ["x", "y", "scale", "rotate", "opacity"] as const;
export type MotionProp = (typeof MOTION_PROPS)[number];

export type EasingName = keyof typeof Easing;

/** [seconds from the Sprite's start, value, easing of the segment that starts here] */
export type Keyframe = [time: number, value: number, ease?: EasingName];

export type MotionValue = number | Keyframe[];

export type MotionSpec = Partial<Record<MotionProp, MotionValue>> & { ox?: number; oy?: number };

/** Neutral value of each property (what "no motion" means). */
export const MOTION_DEFAULTS: Record<MotionProp, number> = { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 };

export const EASING_NAMES = Object.keys(Easing) as EasingName[];

function isEasingName(value: unknown): value is EasingName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(Easing, value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Parse a `data-motion` value; invalid parts are dropped, garbage gives null. */
export function parseMotion(raw: string | null | undefined): MotionSpec | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const spec: MotionSpec = {};
  for (const prop of MOTION_PROPS) {
    const value = record[prop];
    if (finite(value)) spec[prop] = value;
    else if (Array.isArray(value)) {
      const keys: Keyframe[] = [];
      for (const key of value) {
        if (!Array.isArray(key) || !finite(key[0]) || !finite(key[1])) continue;
        keys.push(isEasingName(key[2]) ? [key[0], key[1], key[2]] : [key[0], key[1]]);
      }
      keys.sort((a, b) => a[0] - b[0]);
      if (keys.length) spec[prop] = keys;
    }
  }
  if (finite(record.ox)) spec.ox = record.ox;
  if (finite(record.oy)) spec.oy = record.oy;
  return spec;
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Compact JSON for the attribute (null when there is nothing left to store). */
export function serializeMotion(spec: MotionSpec): string | null {
  const out: Record<string, unknown> = {};
  for (const prop of MOTION_PROPS) {
    const value = spec[prop];
    if (value === undefined) continue;
    if (typeof value === "number") {
      if (round(value) !== MOTION_DEFAULTS[prop]) out[prop] = round(value);
    } else if (value.length) {
      out[prop] = value.map(([t, v, ease]) => (ease && ease !== "linear" ? [round(t), round(v), ease] : [round(t), round(v)]));
    }
  }
  if (Object.keys(out).length === 0) return null;
  if (spec.ox !== undefined) out.ox = round(spec.ox, 1);
  if (spec.oy !== undefined) out.oy = round(spec.oy, 1);
  return JSON.stringify(out);
}

/** Value of one property at `t` (seconds from the Sprite's start). */
export function valueAt(value: MotionValue | undefined, t: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value === "number") return value;
  if (value.length === 0) return fallback;
  if (t <= value[0][0]) return value[0][1];
  const last = value[value.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 0; i < value.length - 1; i++) {
    const [t0, v0, ease] = value[i];
    const [t1, v1] = value[i + 1];
    if (t >= t0 && t <= t1) {
      const span = t1 - t0;
      const p = span > 0 ? clamp((t - t0) / span, 0, 1) : 1;
      return lerp(v0, v1, (ease ? Easing[ease] : Easing.linear)(p));
    }
  }
  return last[1];
}

export interface MotionValues {
  x: number;
  y: number;
  scale: number;
  rotate: number;
  opacity: number;
}

export function motionAt(spec: MotionSpec | null | undefined, t: number): MotionValues {
  return {
    x: valueAt(spec?.x, t, 0),
    y: valueAt(spec?.y, t, 0),
    scale: valueAt(spec?.scale, t, 1),
    rotate: valueAt(spec?.rotate, t, 0),
    opacity: valueAt(spec?.opacity, t, 1),
  };
}

/** Keyframes closer than this count as the same moment (half a frame at 60 fps). */
export const KEY_EPSILON = 1 / 120;

/** A keyframe, with the easing only when it has one (keeps stored JSON and comparisons clean). */
function key(time: number, value: number, ease?: EasingName): Keyframe {
  return ease ? [time, value, ease] : [time, value];
}

export function isAnimated(value: MotionValue | undefined): value is Keyframe[] {
  return Array.isArray(value);
}

export function keyAt(value: MotionValue | undefined, t: number): Keyframe | undefined {
  return isAnimated(value) ? value.find((key) => Math.abs(key[0] - t) < KEY_EPSILON) : undefined;
}

/**
 * Set a property at time `t`: a keyframe when the property is animated (replacing one at the same
 * moment, keeping its easing), otherwise the static value.
 */
export function setValue(spec: MotionSpec, prop: MotionProp, t: number, value: number): MotionSpec {
  const current = spec[prop];
  if (!isAnimated(current)) return { ...spec, [prop]: value };
  const existing = keyAt(current, t);
  const keys = existing
    ? current.map((k) => (k === existing ? key(k[0], value, k[2]) : k))
    : [...current, key(t, value)].sort((a, b) => a[0] - b[0]);
  return { ...spec, [prop]: keys };
}

/** Start animating a property: its current value becomes a keyframe at `t`. */
export function addKey(spec: MotionSpec, prop: MotionProp, t: number): MotionSpec {
  const current = spec[prop];
  const now = valueAt(current, t, MOTION_DEFAULTS[prop]);
  if (isAnimated(current)) return setValue(spec, prop, t, now);
  return { ...spec, [prop]: [[t, now]] as Keyframe[] };
}

/** Remove the keyframe at `t`; the last one removed turns the property static at that value. */
export function removeKey(spec: MotionSpec, prop: MotionProp, t: number): MotionSpec {
  const current = spec[prop];
  if (!isAnimated(current)) return spec;
  const target = keyAt(current, t);
  if (!target) return spec;
  const keys = current.filter((key) => key !== target);
  return { ...spec, [prop]: keys.length ? keys : target[1] };
}

/** Easing of the segment that starts at the keyframe at `t`. */
export function setKeyEase(spec: MotionSpec, prop: MotionProp, t: number, ease: EasingName): MotionSpec {
  const current = spec[prop];
  const target = keyAt(current, t);
  if (!isAnimated(current) || !target) return spec;
  return { ...spec, [prop]: current.map((k) => (k === target ? key(k[0], k[1], ease === "linear" ? undefined : ease) : k)) };
}

/** Every keyframe time of a spec (sorted, merged within KEY_EPSILON), for the timeline. */
export function keyTimes(spec: MotionSpec | null | undefined): number[] {
  if (!spec) return [];
  const times: number[] = [];
  for (const prop of MOTION_PROPS) {
    const value = spec[prop];
    if (!isAnimated(value)) continue;
    for (const [t] of value) if (!times.some((other) => Math.abs(other - t) < KEY_EPSILON)) times.push(t);
  }
  return times.sort((a, b) => a - b);
}

/** Shift every keyframe by `delta` seconds (unused keys stay ordered). */
export function shiftKeys(spec: MotionSpec, from: number, delta: number): MotionSpec {
  const next: MotionSpec = { ...spec };
  for (const prop of MOTION_PROPS) {
    const value = spec[prop];
    if (!isAnimated(value)) continue;
    next[prop] = value
      .map((k) => (Math.abs(k[0] - from) < KEY_EPSILON ? key(Math.max(0, k[0] + delta), k[1], k[2]) : k))
      .sort((a, b) => a[0] - b[0]);
  }
  return next;
}

/**
 * Pure animation math for the Motion Studio runtime: the `Easing` table,
 * `interpolate`, `animate`, `clamp` and `lerp` (CONTRACTS.md §1).
 *
 * Everything here is a pure function of its inputs so it can run in node
 * (unit tests) and in the browser alike. Formulas follow easings.net.
 */

export type EasingFn = (t: number) => number;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const BACK_C1 = 1.70158;
const BACK_C3 = BACK_C1 + 1;
const BACK_C2 = BACK_C1 * 1.525;
const ELASTIC_C4 = (2 * Math.PI) / 3;

export const Easing: Record<
  | "linear"
  | "easeInQuad"
  | "easeOutQuad"
  | "easeInOutQuad"
  | "easeInCubic"
  | "easeOutCubic"
  | "easeInOutCubic"
  | "easeInQuart"
  | "easeOutQuart"
  | "easeInOutQuart"
  | "easeInExpo"
  | "easeOutExpo"
  | "easeInOutExpo"
  | "easeOutBack"
  | "easeInBack"
  | "easeInOutBack"
  | "easeOutElastic"
  | "easeOutBounce",
  EasingFn
> = {
  linear: (t) => t,

  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),

  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),

  easeInQuart: (t) => t * t * t * t,
  easeOutQuart: (t) => 1 - Math.pow(1 - t, 4),
  easeInOutQuart: (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),

  easeInExpo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  easeOutExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  easeInOutExpo: (t) =>
    t === 0
      ? 0
      : t === 1
        ? 1
        : t < 0.5
          ? Math.pow(2, 20 * t - 10) / 2
          : (2 - Math.pow(2, -20 * t + 10)) / 2,

  easeOutBack: (t) => 1 + BACK_C3 * Math.pow(t - 1, 3) + BACK_C1 * Math.pow(t - 1, 2),
  easeInBack: (t) => BACK_C3 * t * t * t - BACK_C1 * t * t,
  easeInOutBack: (t) =>
    t < 0.5
      ? (Math.pow(2 * t, 2) * ((BACK_C2 + 1) * 2 * t - BACK_C2)) / 2
      : (Math.pow(2 * t - 2, 2) * ((BACK_C2 + 1) * (t * 2 - 2) + BACK_C2) + 2) / 2,

  easeOutElastic: (t) =>
    t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ELASTIC_C4) + 1,

  easeOutBounce: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) {
      const u = t - 1.5 / d1;
      return n1 * u * u + 0.75;
    }
    if (t < 2.5 / d1) {
      const u = t - 2.25 / d1;
      return n1 * u * u + 0.9375;
    }
    const u = t - 2.625 / d1;
    return n1 * u * u + 0.984375;
  },
};

/**
 * Piecewise-linear mapping from `input` (ascending) to `output`, clamped at both ends.
 * `easing` is applied to the local 0..1 progress of each segment: either one function
 * for every segment or an array with one function per segment.
 */
export function interpolate(
  input: number[],
  output: number[],
  easing?: EasingFn | EasingFn[],
): (t: number) => number {
  if (input.length === 0 || input.length !== output.length) {
    throw new RangeError(
      `interpolate(): input (${input.length}) and output (${output.length}) must be non-empty and the same length`,
    );
  }
  for (let i = 1; i < input.length; i++) {
    if (input[i] < input[i - 1]) {
      throw new RangeError("interpolate(): input values must be ascending");
    }
  }
  const last = input.length - 1;
  const easeFor = (segment: number): EasingFn => {
    if (Array.isArray(easing)) return easing[segment] ?? Easing.linear;
    return easing ?? Easing.linear;
  };
  return (t: number) => {
    if (last === 0 || t <= input[0]) return output[0];
    if (t >= input[last]) return output[last];
    let i = 0;
    while (i < last - 1 && t >= input[i + 1]) i++;
    const span = input[i + 1] - input[i];
    const p = span === 0 ? 1 : (t - input[i]) / span;
    return lerp(output[i], output[i + 1], easeFor(i)(clamp(p, 0, 1)));
  };
}

export interface AnimateSpec {
  from: number;
  to: number;
  start: number;
  end: number;
  ease?: EasingFn;
}

/** Single tween: `from` before `start`, `to` after `end`, eased in between. */
export function animate({ from, to, start, end, ease = Easing.easeInOutCubic }: AnimateSpec): (t: number) => number {
  return (t: number) => {
    if (end <= start) return t >= start ? to : from;
    const p = clamp((t - start) / (end - start), 0, 1);
    return lerp(from, to, ease(p));
  };
}

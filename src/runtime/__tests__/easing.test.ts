/**
 * Unit tests for the runtime's pure math (easing.ts).
 */
import { describe, expect, it } from "vitest";
import { Easing, animate, clamp, interpolate, lerp } from "../easing";

const EASING_NAMES = [
  "linear",
  "easeInQuad",
  "easeOutQuad",
  "easeInOutQuad",
  "easeInCubic",
  "easeOutCubic",
  "easeInOutCubic",
  "easeInQuart",
  "easeOutQuart",
  "easeInOutQuart",
  "easeInExpo",
  "easeOutExpo",
  "easeInOutExpo",
  "easeOutBack",
  "easeInBack",
  "easeInOutBack",
  "easeOutElastic",
  "easeOutBounce",
] as const;

describe("Easing", () => {
  it("exposes exactly the 18 contract names", () => {
    expect(Object.keys(Easing).sort()).toEqual([...EASING_NAMES].sort());
  });

  it.each(EASING_NAMES)("%s maps 0 -> 0 and 1 -> 1", (name) => {
    expect(Easing[name](0)).toBeCloseTo(0, 10);
    expect(Easing[name](1)).toBeCloseTo(1, 10);
  });

  it("matches reference values at t = 0.5", () => {
    expect(Easing.linear(0.5)).toBe(0.5);
    expect(Easing.easeInQuad(0.5)).toBe(0.25);
    expect(Easing.easeOutQuad(0.5)).toBe(0.75);
    expect(Easing.easeInOutQuad(0.5)).toBe(0.5);
    expect(Easing.easeInCubic(0.5)).toBe(0.125);
    expect(Easing.easeOutCubic(0.5)).toBe(0.875);
    expect(Easing.easeInOutCubic(0.25)).toBeCloseTo(0.0625);
    expect(Easing.easeInQuart(0.5)).toBe(0.0625);
    expect(Easing.easeOutQuart(0.5)).toBe(0.9375);
    expect(Easing.easeInOutQuart(0.5)).toBe(0.5);
    expect(Easing.easeInExpo(0.5)).toBeCloseTo(Math.pow(2, -5));
    expect(Easing.easeOutExpo(0.5)).toBeCloseTo(1 - Math.pow(2, -5));
    expect(Easing.easeInOutExpo(0.5)).toBe(0.5);
    expect(Easing.easeInOutBack(0.5)).toBe(0.5);
    expect(Easing.easeOutBounce(0.5)).toBeCloseTo(0.765625);
  });

  it("back easings overshoot", () => {
    expect(Easing.easeInBack(0.3)).toBeLessThan(0);
    expect(Easing.easeOutBack(0.7)).toBeGreaterThan(1);
  });

  it("elastic settles inside (0,1) range ends and oscillates", () => {
    expect(Easing.easeOutElastic(0.1)).toBeGreaterThan(1);
    expect(Easing.easeOutElastic(0.95)).toBeCloseTo(1, 1);
  });
});

describe("clamp / lerp", () => {
  it("clamps", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(0.3, 0, 1)).toBe(0.3);
  });
  it("lerps", () => {
    expect(lerp(10, 20, 0.5)).toBe(15);
    expect(lerp(10, 20, 0)).toBe(10);
  });
});

describe("interpolate", () => {
  it("is piecewise linear and clamps outside the range", () => {
    const f = interpolate([0, 1, 3], [0, 10, 0]);
    expect(f(-5)).toBe(0);
    expect(f(0)).toBe(0);
    expect(f(0.5)).toBe(5);
    expect(f(1)).toBe(10);
    expect(f(2)).toBe(5);
    expect(f(3)).toBe(0);
    expect(f(99)).toBe(0);
  });

  it("applies one easing to every segment", () => {
    const f = interpolate([0, 1, 2], [0, 1, 2], Easing.easeInQuad);
    expect(f(0.5)).toBe(0.25);
    expect(f(1.5)).toBe(1.25);
  });

  it("applies per-segment easings", () => {
    const f = interpolate([0, 1, 2], [0, 1, 2], [Easing.easeInQuad, Easing.linear]);
    expect(f(0.5)).toBe(0.25);
    expect(f(1.5)).toBe(1.5);
  });

  it("handles a single stop and zero-length segments", () => {
    expect(interpolate([2], [7])(0)).toBe(7);
    const f = interpolate([0, 1, 1, 2], [0, 1, 5, 6]);
    expect(f(0.5)).toBe(0.5);
    expect(f(1.5)).toBe(5.5);
  });

  it("rejects malformed stops", () => {
    expect(() => interpolate([0, 1], [0])).toThrow(RangeError);
    expect(() => interpolate([], [])).toThrow(RangeError);
    expect(() => interpolate([1, 0], [0, 1])).toThrow(RangeError);
  });
});

describe("animate", () => {
  it("tweens with easeInOutCubic by default", () => {
    const f = animate({ from: 0, to: 100, start: 1, end: 3 });
    expect(f(0)).toBe(0);
    expect(f(1)).toBe(0);
    expect(f(2)).toBe(50);
    expect(f(1.5)).toBeCloseTo(100 * Easing.easeInOutCubic(0.25));
    expect(f(3)).toBe(100);
    expect(f(10)).toBe(100);
  });

  it("accepts a custom easing", () => {
    const f = animate({ from: 10, to: 20, start: 0, end: 1, ease: Easing.linear });
    expect(f(0.25)).toBe(12.5);
  });

  it("steps when the window is empty", () => {
    const f = animate({ from: 1, to: 2, start: 2, end: 2 });
    expect(f(1.99)).toBe(1);
    expect(f(2)).toBe(2);
  });
});

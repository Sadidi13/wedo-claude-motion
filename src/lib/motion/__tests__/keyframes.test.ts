/** Layer motion (docs/TRANSFORM.md): parsing, writing, interpolation and keyframe edits. */
import { describe, expect, it } from "vitest";
import {
  addKey,
  keyTimes,
  motionAt,
  parseMotion,
  removeKey,
  serializeMotion,
  setKeyEase,
  setValue,
  shiftKeys,
  valueAt,
  type MotionSpec,
} from "../keyframes";

describe("parse and serialize", () => {
  it("round-trips static values and keyframes, dropping neutral values", () => {
    const spec = parseMotion('{"x":40,"y":0,"scale":1.2,"opacity":[[0,0],[0.5,1,"easeOutCubic"]],"ox":10}');
    expect(spec).toEqual({ x: 40, y: 0, scale: 1.2, opacity: [[0, 0], [0.5, 1, "easeOutCubic"]], ox: 10 });
    expect(serializeMotion(spec!)).toBe('{"x":40,"scale":1.2,"opacity":[[0,0],[0.5,1,"easeOutCubic"]],"ox":10}');
  });

  it("ignores garbage, unknown easings and bad keyframes", () => {
    expect(parseMotion("not json")).toBeNull();
    expect(parseMotion("[1,2]")).toBeNull();
    expect(parseMotion('{"x":[[0,1,"bogus"],["a",2],[1,3]],"rotate":"12"}')).toEqual({ x: [[0, 1], [1, 3]] });
  });

  it("stores nothing when everything is neutral", () => {
    expect(serializeMotion({ x: 0, scale: 1, opacity: 1 })).toBeNull();
  });
});

describe("interpolation", () => {
  const spec: MotionSpec = { x: [[0, -100], [1, 0, "easeOutCubic"], [2, 50]], scale: 1.5 };

  it("holds before the first and after the last keyframe", () => {
    expect(valueAt(spec.x, -1, 0)).toBe(-100);
    expect(valueAt(spec.x, 3, 0)).toBe(50);
  });

  it("is linear by default and uses the easing of the segment's first keyframe", () => {
    expect(valueAt(spec.x, 0.5, 0)).toBe(-50);
    expect(valueAt(spec.x, 1.5, 0)).toBeCloseTo(50 * (1 - (1 - 0.5) ** 3), 6);
  });

  it("gives every property, with defaults", () => {
    expect(motionAt(spec, 0.5)).toEqual({ x: -50, y: 0, scale: 1.5, rotate: 0, opacity: 1 });
    expect(motionAt(null, 1)).toEqual({ x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 });
  });
});

describe("editing", () => {
  it("sets static values, or a keyframe when the property is animated", () => {
    expect(setValue({}, "x", 1, 30)).toEqual({ x: 30 });
    const animated = setValue({ x: [[0, 0]] }, "x", 1, 30);
    expect(animated.x).toEqual([[0, 0], [1, 30]]);
    expect(setValue(animated, "x", 1 + 1 / 1000, 40).x).toEqual([[0, 0], [1, 40]]);
  });

  it("starts and stops animating a property", () => {
    const keyed = addKey({ x: 25 }, "x", 0.5);
    expect(keyed.x).toEqual([[0.5, 25]]);
    expect(removeKey(keyed, "x", 0.5)).toEqual({ x: 25 });
    const two = addKey(setValue(keyed, "x", 1.5, 0), "x", 1.5);
    expect(removeKey(two, "x", 1.5).x).toEqual([[0.5, 25]]);
  });

  it("sets the easing of the segment starting at a keyframe", () => {
    const spec = setKeyEase({ x: [[0, 0], [1, 10]] }, "x", 0, "easeInOutCubic");
    expect(spec.x).toEqual([[0, 0, "easeInOutCubic"], [1, 10]]);
  });

  it("lists keyframe times across properties and moves them", () => {
    const spec: MotionSpec = { x: [[0, 0], [1, 10]], opacity: [[1, 1], [2, 0]] };
    expect(keyTimes(spec)).toEqual([0, 1, 2]);
    expect(keyTimes(shiftKeys(spec, 1, 0.25))).toEqual([0, 1.25, 2]);
  });
});

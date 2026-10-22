/**
 * Unit tests for the runtime clock store (clock.ts): snapshot identity,
 * subscribe / notify, time clamping and meta registration.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RUNTIME_DEFAULT_META, getClock, resetClock, setClock, subscribeClock } from "../clock";

beforeEach(() => resetClock());

describe("clock store", () => {
  it("starts at time 0, not playing, with the runtime default meta", () => {
    expect(getClock()).toEqual({ time: 0, playing: false, meta: { width: 1280, height: 720, duration: 10, fps: 30 } });
    expect(getClock().meta).toBe(RUNTIME_DEFAULT_META);
  });

  it("set + get: a new snapshot only when something changed", () => {
    const before = getClock();
    setClock({ time: 0, playing: false });
    expect(getClock()).toBe(before);
    setClock({ time: 2.5 });
    expect(getClock()).not.toBe(before);
    expect(getClock()).toMatchObject({ time: 2.5, playing: false });
    setClock({ playing: true });
    expect(getClock()).toMatchObject({ time: 2.5, playing: true });
  });

  it("notifies subscribers once per change and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeClock(listener);
    setClock({ time: 1 });
    setClock({ time: 1 }); // unchanged: no notification
    setClock({ playing: true });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    setClock({ time: 2 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("clamps time to [0, meta.duration] and ignores non-finite values", () => {
    setClock({ time: -1 });
    expect(getClock().time).toBe(0);
    setClock({ time: 99 });
    expect(getClock().time).toBe(10);
    setClock({ time: 4 });
    setClock({ time: Number.NaN });
    expect(getClock().time).toBe(4);
    setClock({ time: Number.POSITIVE_INFINITY });
    expect(getClock().time).toBe(4);
  });

  it("registers meta; a value-equal meta keeps the previous object (no notification)", () => {
    const meta = { width: 640, height: 360, duration: 4, fps: 24, background: "#000" };
    const listener = vi.fn();
    subscribeClock(listener);
    setClock({ meta });
    expect(getClock().meta).toBe(meta);
    setClock({ meta: { ...meta } });
    expect(getClock().meta).toBe(meta);
    expect(listener).toHaveBeenCalledTimes(1);
    // a time written together with a new meta is clamped to the new duration
    setClock({ meta: { ...meta, duration: 2 }, time: 3 });
    expect(getClock()).toMatchObject({ time: 2, meta: { duration: 2 } });
  });

  it("leaves the time where it is when a shorter meta registers (the host seeks afterwards)", () => {
    setClock({ time: 7 });
    setClock({ meta: { ...RUNTIME_DEFAULT_META, duration: 5 } });
    expect(getClock().time).toBe(7);
  });
});

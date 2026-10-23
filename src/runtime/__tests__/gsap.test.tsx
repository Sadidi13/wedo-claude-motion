// @vitest-environment happy-dom
/**
 * useGsapTimeline in a DOM (CONTRACTS.md §1 "GSAP"): a GSAP timeline inside a
 * Sprite follows the Sprite's local time through `window.__seek`, the styles
 * at a time do not depend on the order of the seeks (forwards, backwards, or
 * after the Sprite unmounted and mounted again), and GSAP's own clock never
 * moves a tween made outside the hook.
 */
import gsap from "gsap";
import React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetClock } from "../clock";
import { motionWindow } from "../globals";
import { Sprite, Stage, useGsapTimeline } from "../index";

function Box() {
  const ref = useGsapTimeline((tl) => {
    tl.fromTo(".box", { x: 0, opacity: 0 }, { x: 300, opacity: 1, duration: 1, ease: "power2.out" }).to(
      ".box",
      { rotation: 90, duration: 0.5, ease: "none" },
      1,
    );
  });
  return (
    <div ref={ref}>
      <div className="box" />
    </div>
  );
}

function Scene() {
  return (
    <Stage width={640} height={360} duration={3} fps={30}>
      <Sprite start={0.5} end={3}>
        <Box />
      </Sprite>
    </Stage>
  );
}

let host: HTMLDivElement;
let root: Root;

function seek(t: number): void {
  motionWindow()?.__seek?.(t);
}

/** The box's inline style and GSAP's own reading of x / opacity / rotation, or null when unmounted. */
function snapshot(): { style: string; x: number; opacity: number; rotation: number } | null {
  const box = host.querySelector<HTMLElement>(".box");
  if (!box) return null;
  return {
    style: box.getAttribute("style") ?? "",
    x: Number(gsap.getProperty(box, "x")),
    opacity: Number(gsap.getProperty(box, "opacity")),
    rotation: Number(gsap.getProperty(box, "rotation")),
  };
}

beforeEach(() => {
  (window as unknown as { __EMBED?: boolean }).__EMBED = true; // time only moves through __seek
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root.render(<Scene />));
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  resetClock();
});

describe("useGsapTimeline", () => {
  it("follows the Sprite's local time", () => {
    seek(0.2);
    expect(snapshot()).toBeNull(); // before the Sprite's start: not mounted

    seek(1); // local 0.5 s: power2.out is cubic, 1 − (1 − 0.5)³ = 0.875 of the way
    expect(snapshot()).toMatchObject({ x: 262.5, opacity: 0.875, rotation: 0 });

    seek(2); // local 1.5 s: tween done, rotation finished at 1.5
    expect(snapshot()).toMatchObject({ x: 300, opacity: 1, rotation: 90 });
  });

  it("gives the same styles at a time whatever order the seeks come in", () => {
    const times = [0.6, 1, 1.45, 1.75, 2.9];
    const record = (order: number[]) => {
      const seen = new Map<number, ReturnType<typeof snapshot>>();
      for (const t of order) {
        seek(t);
        seen.set(t, snapshot());
      }
      return times.map((t) => seen.get(t));
    };

    const forwards = record(times);
    const backwards = record([...times].reverse());
    // through a time outside the Sprite (unmount + fresh build) before every sample
    const remounted = record(times.flatMap((t) => [0.1, t]));
    const shuffled = record([1.75, 0.6, 2.9, 1, 1.45]);

    expect(forwards.every((s) => s !== null)).toBe(true);
    expect(backwards).toEqual(forwards);
    expect(remounted).toEqual(forwards);
    expect(shuffled).toEqual(forwards);
  });

  it("never lets GSAP's own clock move a tween made outside the hook", async () => {
    const target = { x: 0 };
    gsap.to(target, { x: 100, duration: 0.05 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(target.x).toBe(0);
    expect(gsap.globalTimeline.paused()).toBe(true);
  });
});

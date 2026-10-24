// @vitest-environment happy-dom
/**
 * Layer motion in a DOM (docs/TRANSFORM.md): `data-motion` on an element or a
 * Sprite is applied after every seek, keyframes run on the Sprite's clock, the
 * opacity multiplies the scene's own, a live override replaces the attribute,
 * and removing the attribute clears what was written.
 */
import React, { useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetClock } from "../clock";
import { motionWindow } from "../globals";
import { Sprite, Stage, useSprite } from "../index";
import { clearMotionOverrides, setMotionOverride } from "../layerMotion";

let setMotion: (value: string | undefined) => void = () => undefined;

function Card() {
  const { progress } = useSprite();
  return <div data-layer-id="card" data-motion='{"x":[[0,100],[1,0]],"opacity":0.5}' style={{ opacity: 0.8 + progress * 0 }} />;
}

function Scene() {
  const [motion, set] = useState<string | undefined>('{"rotate":10}');
  useLayoutEffect(() => {
    setMotion = set;
  }, [set]);
  return (
    <Stage width={640} height={360} duration={4} fps={30}>
      <Sprite start={1} end={4} data-layer-id="sprite" {...(motion ? { "data-motion": motion } : {})}>
        <Card />
      </Sprite>
    </Stage>
  );
}

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  resetClock();
  clearMotionOverrides();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root.render(<Scene />));
});

afterEach(() => {
  root.unmount();
  host.remove();
});

const seek = (t: number) => motionWindow()!.__seek!(t);
const card = () => host.querySelector<HTMLElement>('[data-layer-id="card"]')!;
const sprite = () => host.querySelector<HTMLElement>('[data-layer-id="sprite"]')!;

describe("layer motion", () => {
  it("runs keyframes on the Sprite's clock", () => {
    seek(1);
    expect(card().style.translate).toBe("100px 0px");
    seek(1.5);
    expect(card().style.translate).toBe("50px 0px");
    seek(3);
    expect(card().style.translate).toBe("");
  });

  it("multiplies the scene's own opacity once, however often it renders", () => {
    seek(1.5);
    expect(Number(card().style.opacity)).toBeCloseTo(0.4, 5);
    seek(1.6);
    seek(1.7);
    expect(Number(card().style.opacity)).toBeCloseTo(0.4, 5);
  });

  it("applies to a Sprite's wrapper and clears when the attribute goes away", () => {
    seek(2);
    expect(sprite().style.rotate).toBe("10deg");
    flushSync(() => setMotion(undefined));
    seek(2.1);
    expect(sprite().style.rotate).toBe("");
  });

  it("shows a live override until it is dropped", () => {
    seek(2);
    setMotionOverride("sprite", { x: 30, rotate: 0 });
    expect(sprite().style.translate).toBe("30px 0px");
    expect(sprite().style.rotate).toBe("");
    setMotionOverride("sprite", undefined);
    expect(sprite().style.rotate).toBe("10deg");
  });
});

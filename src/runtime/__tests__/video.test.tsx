// @vitest-environment happy-dom
/**
 * <Video> in export (render) mode (docs/VIDEO.md): each seek draws the library frame for the
 * Sprite's local time plus `from`, the frame is held until the metadata and that image are in,
 * and the sound is reported for the mix over the Sprite's window.
 */
import React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaMeta } from "@/lib/media";
import { resetClock } from "../clock";
import { motionWindow } from "../globals";
import { Sprite, Stage, Video, audioClips, resetAudioClips } from "../index";
import { pendingHolds } from "../pending";

const META: MediaMeta = {
  id: "k3f9x2abcd12", name: "talk.mp4", ext: "mp4", size: 1, state: "ready", duration: 46.35, sourceFps: 29.97,
  width: 2160, height: 3840, hasAudio: true, frameRate: 30, frameCount: 1390, frameWidth: 1440, frameHeight: 2560,
  createdAt: "2026-11-02T00:00:00.000Z",
};

function Scene() {
  return (
    <Stage width={1080} height={1920} duration={10} fps={30}>
      <Sprite start={1} end={5}>
        <Video data-layer-id="clip" src="media/k3f9x2abcd12.mp4" from={2} volume={0.8} />
      </Sprite>
    </Stage>
  );
}

let host: HTMLDivElement;
let root: Root;
let decodes: Array<() => void>;

const seek = (t: number) => motionWindow()?.__seek?.(t);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  const w = window as unknown as { __EMBED?: boolean; __RENDER_MODE?: boolean };
  w.__EMBED = true;
  w.__RENDER_MODE = true;
  decodes = [];
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(META), { status: 200 })));
  vi.spyOn(HTMLImageElement.prototype, "decode").mockImplementation(() => new Promise<void>((resolve) => decodes.push(resolve)));
  resetAudioClips();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root.render(<Scene />));
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  resetClock();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  const w = window as unknown as { __RENDER_MODE?: boolean };
  delete w.__RENDER_MODE;
});

describe("<Video> in exports", () => {
  it("draws the frame for local time + from, holding the frame until it is decoded", async () => {
    seek(2.5); // local 1.5 s + from 2 s = 3.5 s → frame 105
    expect(pendingHolds()).toBeGreaterThan(0); // metadata not in yet
    await flush();
    await flush();
    const img = host.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/api/media/k3f9x2abcd12/frames/105");
    expect(pendingHolds()).toBe(1); // the image is decoding
    decodes.forEach((resolve) => resolve());
    await flush();
    expect(pendingHolds()).toBe(0);

    seek(3); // local 2 s + 2 s = 4 s → frame 120, held again until decoded
    expect(host.querySelector("img")?.getAttribute("src")).toBe("/api/media/k3f9x2abcd12/frames/120");
    expect(pendingHolds()).toBe(1);
    decodes.forEach((resolve) => resolve());
    await flush();
    expect(pendingHolds()).toBe(0);
  });

  it("reports its sound over the Sprite's window, from the original file", async () => {
    seek(2);
    await flush();
    await flush();
    decodes.forEach((resolve) => resolve());
    expect(audioClips()).toEqual([
      { key: "clip", src: "media/k3f9x2abcd12", start: 1, end: 5, from: 2, volume: 0.8, fadeIn: 0, fadeOut: 0, loop: false },
    ]);
  });
});

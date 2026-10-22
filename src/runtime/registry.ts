/**
 * Registry of mounted <Stage> instances and the `window.__*` globals that
 * point at the top-most one (CONTRACTS.md §1 "Globals the runtime installs").
 *
 * A stack (instead of "last mount wins") lets the preview page load a new
 * project next to the current one and, if the new one fails, unmount it and
 * get the previous stage's `__seek` / `__getLayerRects` back automatically.
 *
 * The top-most stage also owns the runtime clock (clock.ts): its meta is
 * published there so `useStage()` / `useTimeline()` called outside the Stage
 * subtree report the right duration / fps. When the last stage unmounts the
 * clock keeps its meta; the next stage re-registers.
 */

import type { LayerRect, StageMeta } from "@/lib/types";
import { setClock } from "./clock";
import { motionWindow } from "./globals";

export interface StageHandle {
  meta: StageMeta;
  seek: (time: number) => void;
  setTransparent: (transparent: boolean) => void;
  /** the `[data-stage]` element, null before the ref is attached */
  element: () => HTMLElement | null;
}

const stack: StageHandle[] = [];

function installGlobals(handle: StageHandle | undefined): void {
  const w = motionWindow();
  if (!w) return;
  if (!handle) {
    delete w.__videoMeta;
    delete w.__seek;
    delete w.__getLayerRects;
    delete w.__setTransparent;
    w.__ready = false;
    return;
  }
  // Delegate to the handle's *current* fields: a Stage refreshes them in place on re-render.
  w.__videoMeta = { ...handle.meta };
  w.__seek = (time) => handle.seek(time);
  w.__setTransparent = (transparent) => handle.setTransparent(transparent);
  w.__getLayerRects = () => measureLayerRects(handle);
  w.__ready = true;
}

/** Make `handle` the document's stage: clock meta + window globals. */
function activate(handle: StageHandle | undefined): void {
  if (handle) setClock({ meta: handle.meta });
  installGlobals(handle);
}

/** Register a stage (or refresh its handle) and expose it on `window`. */
export function registerStage(handle: StageHandle): void {
  if (!stack.includes(handle)) stack.push(handle);
  if (stack[stack.length - 1] === handle) activate(handle);
}

/** Remove a stage; the previous stage (if any) becomes the global one again. */
export function unregisterStage(handle: StageHandle): void {
  const i = stack.indexOf(handle);
  if (i === -1) return;
  const wasTop = i === stack.length - 1;
  stack.splice(i, 1);
  if (wasTop) activate(stack[stack.length - 1]);
}

/**
 * Bounding boxes of every `[data-layer-id]` inside the stage, in stage
 * coordinates: relative to the stage element and divided by its on-screen
 * scale (the stage is always exactly `meta.width` CSS px wide before scaling).
 */
export function measureLayerRects(handle: StageHandle): LayerRect[] {
  const stage = handle.element();
  if (!stage) return [];
  const stageRect = stage.getBoundingClientRect();
  const scale = stageRect.width > 0 && handle.meta.width > 0 ? stageRect.width / handle.meta.width : 1;
  const rects: LayerRect[] = [];
  stage.querySelectorAll<HTMLElement>("[data-layer-id]").forEach((el) => {
    const id = el.getAttribute("data-layer-id");
    if (!id) return;
    const r = el.getBoundingClientRect();
    rects.push({
      id,
      x: (r.left - stageRect.left) / scale,
      y: (r.top - stageRect.top) / scale,
      width: r.width / scale,
      height: r.height / scale,
    });
  });
  return rects;
}

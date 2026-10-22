/**
 * Converts a layer rect in stage coordinates (from window.__getLayerRects)
 * into a box positioned inside the preview host element, accounting for the
 * stage's on-screen offset and scale (1 in embed mode, fit-to-viewport in
 * standalone mode).
 */

import type { LayerRect } from "@/lib/types";

export interface RectLike {
  left: number;
  top: number;
  width: number;
}

export interface OverlayBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function toOverlayBox(rect: LayerRect, stageRect: RectLike, hostRect: RectLike, stageWidth: number): OverlayBox {
  const scale = stageWidth > 0 && stageRect.width > 0 ? stageRect.width / stageWidth : 1;
  return {
    left: stageRect.left - hostRect.left + rect.x * scale,
    top: stageRect.top - hostRect.top + rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

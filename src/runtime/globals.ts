/**
 * Typed view of the `window` globals shared between the runtime, the loader,
 * the preview page and the headless export renderer (CONTRACTS.md §1, §3, §6).
 *
 * We deliberately do NOT augment the global `Window` interface: other modules
 * (e.g. the export renderer's `page.evaluate` code) may declare their own view
 * of these globals and conflicting augmentations would not compile. Use
 * `motionWindow()` instead of touching `window` directly.
 */

import type { LayerRect, StageMeta } from "@/lib/types";

export interface MotionWindow {
  /** set by the preview page when hosted inside the editor iframe */
  __EMBED?: boolean;
  /** set by the preview page for headless export (`?__render=1`) */
  __RENDER_MODE?: boolean;
  /** installed by <Stage> on mount */
  __videoMeta?: StageMeta;
  __seek?: (time: number) => void;
  __ready?: boolean;
  __getLayerRects?: () => LayerRect[];
  __setTransparent?: (transparent: boolean) => void;
}

/** The current window as a MotionWindow, or undefined during SSR. */
export function motionWindow(): MotionWindow | undefined {
  if (typeof window === "undefined") return undefined;
  return window as unknown as MotionWindow;
}

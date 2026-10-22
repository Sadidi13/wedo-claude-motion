"use client";
/**
 * The 1px selection outline the editor asks for with `{type:"highlight"}`.
 * Lives outside the stage (preview-side only, never part of an export) and
 * ignores pointer events so clicks still reach the layers underneath.
 */

import type { OverlayBox } from "./geometry";

export function HighlightOverlay({ box }: { box: OverlayBox }) {
  return (
    <div
      data-preview-highlight=""
      style={{
        position: "absolute",
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        outline: "1px solid #7c9cff",
        pointerEvents: "none",
        boxSizing: "border-box",
      }}
    />
  );
}

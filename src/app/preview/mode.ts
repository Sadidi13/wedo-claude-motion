/**
 * Preview page modes (CONTRACTS.md §3) and the document-level side effects of
 * entering one. `detectPreviewMode` is pure; `applyDocumentMode` touches
 * window/document and must run before any project is loaded, because the
 * runtime reads `window.__EMBED` / `__RENDER_MODE` when a Stage mounts.
 *
 *   render     ?__render=1 — headless export: bare stage at the origin
 *   embed      inside the editor iframe — driven by postMessage
 *   standalone opened directly — the runtime plays the scene with its own chrome
 */

import { motionWindow } from "@/runtime/globals";

export type PreviewMode = "render" | "embed" | "standalone";

export function detectPreviewMode(input: { render: boolean; inIframe: boolean }): PreviewMode {
  if (input.render) return "render";
  if (input.inIframe) return "embed";
  return "standalone";
}

export function applyDocumentMode(mode: PreviewMode): void {
  const w = motionWindow();
  if (!w) return;
  w.__EMBED = mode === "embed";
  w.__RENDER_MODE = mode === "render";
  if (mode === "standalone") return;

  // The editor (or the export clip) decides what is behind the stage: make the
  // document itself transparent and remove every offset around the origin.
  const html = document.documentElement.style;
  const body = document.body.style;
  html.background = "transparent";
  body.background = "transparent";
  body.margin = "0";
  body.padding = "0";
  html.overflow = "hidden";
  body.overflow = "hidden";
}

"use client";
/**
 * Centre canvas: hosts the /preview iframe, scales the stage to fit
 * (min(availW/width, availH/height) × 0.92), draws the checkerboard behind a
 * transparent stage and the selection outline from the store's `layerRects`.
 *
 * Preview protocol (CONTRACTS §3) through previewBridge:
 *   iframe load → debounced `load` on every filesRevision change (150ms)
 *   `ready`      → clear previewError, seek to the current time
 *   time change  → `seek` (store subscription, no React re-render here)
 *   `layerRects` / `select` / `error` / `warning` → store
 */
import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useEditorStore } from "@/store/editorStore";
import { createPreviewBridge, listenToPreview, type PreviewBridge } from "@/store/previewBridge";
import { useResizeObserver } from "./hooks/useResizeObserver";

const FIT_MARGIN = 0.92;
const LOAD_DEBOUNCE_MS = 150;

function isTransparent(background: string | undefined): boolean {
  const value = (background ?? "").trim().toLowerCase();
  return value === "" || value === "transparent" || value === "none";
}

export function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const size = useResizeObserver(containerRef);
  const [frameLoaded, setFrameLoaded] = useState(false);

  const { meta, selectedId, selectedName, layerRects, previewReady, hasProject, filesRevision } = useEditorStore(
    useShallow((s) => ({
      meta: s.scene?.meta ?? s.project?.meta ?? null,
      selectedId: s.selectedId,
      selectedName: s.selectedId ? (s.scene?.byId[s.selectedId]?.name ?? null) : null,
      layerRects: s.layerRects,
      previewReady: s.previewReady,
      hasProject: s.project !== null,
      filesRevision: s.filesRevision,
    })),
  );

  // The bridge and the listeners live for the component's lifetime; the iframe
  // window is resolved lazily on every post (the ref may not be attached yet).
  const bridgeRef = useRef<PreviewBridge | null>(null);
  useEffect(() => {
    const getWindow = () => iframeRef.current?.contentWindow;
    const bridge = createPreviewBridge(getWindow);
    bridgeRef.current = bridge;
    const unlisten = listenToPreview(getWindow, (message) => {
      const store = useEditorStore.getState();
      switch (message.type) {
        case "ready":
          store.setPreviewReady(true);
          store.setPreviewError(null);
          bridge.seek(store.time);
          break;
        case "layerRects":
          store.setLayerRects(message.rects);
          break;
        case "select":
          store.select(message.id);
          // The click happened inside the iframe, which now holds keyboard focus;
          // pull it back so the editor hotkeys (Space, arrows, Delete…) keep working.
          containerRef.current?.focus({ preventScroll: true });
          break;
        case "error":
          store.setPreviewError(message.message, message.stack ?? null);
          break;
        case "warning":
          store.setNotice({ kind: "warning", message: message.message });
          break;
      }
    });
    // Seek on every time change without re-rendering the canvas.
    const unsubscribe = useEditorStore.subscribe((state, previous) => {
      if (state.time !== previous.time) bridge.seek(state.time);
    });
    return () => {
      unlisten();
      unsubscribe();
      bridgeRef.current = null;
    };
  }, []);

  // (Re)load the project whenever a file changes, debounced.
  useEffect(() => {
    if (!frameLoaded || !hasProject) return;
    const timer = setTimeout(() => {
      const store = useEditorStore.getState();
      if (store.project) bridgeRef.current?.load(store.project, store.time);
    }, LOAD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [frameLoaded, hasProject, filesRevision]);

  // Fresh rects for a newly selected layer.
  useEffect(() => {
    if (selectedId) bridgeRef.current?.getLayerRects();
  }, [selectedId]);

  const scale = meta && size.width > 0 && size.height > 0 ? Math.min(size.width / meta.width, size.height / meta.height) * FIT_MARGIN : 1;
  const stageWidth = meta ? meta.width * scale : 0;
  const stageHeight = meta ? meta.height * scale : 0;
  const left = Math.max(0, (size.width - stageWidth) / 2);
  const top = Math.max(0, (size.height - stageHeight) / 2);
  const selectedRect = selectedId ? layerRects.find((rect) => rect.id === selectedId) : undefined;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="relative min-h-0 min-w-0 overflow-hidden bg-[#0c0e13] outline-none"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) useEditorStore.getState().select(null);
      }}
    >
      {meta && (
        <>
          <div
            aria-hidden
            className={isTransparent(meta.background) ? "ms-checker absolute" : "absolute"}
            style={{ left, top, width: stageWidth, height: stageHeight, boxShadow: "0 0 0 1px var(--border), 0 20px 60px rgba(0,0,0,.5)" }}
          />
          <iframe
            ref={iframeRef}
            title="Preview"
            src="/preview"
            // Same-origin on purpose (CONTRACTS §3): the postMessage bridge is origin-checked and
            // the export renderer opens the very same page. A sandbox with allow-same-origin +
            // allow-scripts would add nothing but a browser warning.
            onLoad={() => setFrameLoaded(true)}
            width={meta.width}
            height={meta.height}
            style={{
              position: "absolute",
              left,
              top,
              width: meta.width,
              height: meta.height,
              transform: `scale(${scale})`,
              transformOrigin: "0 0",
              border: 0,
              background: "transparent",
              colorScheme: "normal",
            }}
          />
          {selectedRect && (
            <div
              aria-hidden
              className="pointer-events-none absolute"
              style={{
                left: left + selectedRect.x * scale,
                top: top + selectedRect.y * scale,
                width: selectedRect.width * scale,
                height: selectedRect.height * scale,
                outline: "1.5px solid var(--accent)",
                outlineOffset: 0,
              }}
            >
              <span className="absolute -top-5 left-0 max-w-[240px] truncate rounded-sm bg-accent px-1.5 py-0.5 text-[10.5px] font-medium leading-4 text-[#0b0d14]">
                {selectedName ?? selectedId}
              </span>
            </div>
          )}
        </>
      )}
      {(!previewReady || !meta) && (
        <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 rounded bg-panel-2/90 px-2 py-1 text-[11px] text-muted">
          <LoaderCircle size={12} className="animate-spin" />
          {meta ? "Rendering preview…" : "Loading project…"}
        </div>
      )}
      {meta && previewReady && (
        <div className="pointer-events-none absolute bottom-3 right-3 rounded bg-panel-2/90 px-2 py-1 font-mono text-[11px] tabular-nums text-muted">
          {Math.round(scale * 100)}%
        </div>
      )}
    </div>
  );
}

/**
 * Typed postMessage helpers between the editor and the /preview iframe
 * (CONTRACTS §3). Outgoing messages are posted to the iframe window with our
 * own origin as the target; incoming ones are accepted only from our origin
 * and validated structurally (`isPreviewMessage`) before reaching the store.
 */
import type { EditorToPreviewMessage, LayerRect, PreviewToEditorMessage, Project } from "@/lib/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isLayerRect(value: unknown): value is LayerRect {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isNumber(value.x) &&
    isNumber(value.y) &&
    isNumber(value.width) &&
    isNumber(value.height) &&
    (value.visible === undefined || typeof value.visible === "boolean")
  );
}

/** Structural guard for preview → editor messages. */
export function isPreviewMessage(data: unknown): data is PreviewToEditorMessage {
  if (!isRecord(data)) return false;
  switch (data.type) {
    case "ready":
      return (
        isRecord(data.meta) &&
        isNumber(data.meta.width) &&
        isNumber(data.meta.height) &&
        isNumber(data.meta.duration) &&
        isNumber(data.meta.fps)
      );
    case "layerRects":
      return Array.isArray(data.rects) && data.rects.every(isLayerRect);
    case "select":
      return data.id === null || typeof data.id === "string";
    case "error":
      return typeof data.message === "string" && (data.stack === undefined || typeof data.stack === "string");
    case "warning":
      return typeof data.message === "string";
    default:
      return false;
  }
}

export interface PreviewBridge {
  load(project: Project, time?: number): void;
  seek(time: number): void;
  getLayerRects(): void;
  highlight(id: string | null): void;
  setTransparent(transparent: boolean): void;
  playback(playing: boolean, muted: boolean): void;
  /** live data-motion JSON for a layer while dragging; null returns to the code's own */
  motionOverride(id: string, motion: string | null): void;
}

/**
 * Bridge bound to a lazily-resolved iframe window (the ref may not be
 * attached yet, or the iframe may be re-created). Messages are dropped when
 * there is no window.
 */
export function createPreviewBridge(getTarget: () => Window | null | undefined, origin?: string): PreviewBridge {
  const post = (message: EditorToPreviewMessage) => {
    const target = getTarget();
    if (!target) return;
    const targetOrigin = origin ?? (typeof window !== "undefined" ? window.location.origin : "*");
    target.postMessage(message, targetOrigin);
  };
  return {
    load: (project, time) => post({ type: "load", project, time }),
    seek: (time) => post({ type: "seek", time }),
    getLayerRects: () => post({ type: "getLayerRects" }),
    highlight: (id) => post({ type: "highlight", id }),
    setTransparent: (transparent) => post({ type: "setTransparent", transparent }),
    playback: (playing, muted) => post({ type: "playback", playing, muted }),
    motionOverride: (id, motion) => post({ type: "motionOverride", id, motion }),
  };
}

/**
 * Subscribe to validated preview messages coming from `source` (the iframe's
 * window). Returns the unsubscribe function.
 */
export function listenToPreview(
  getSource: () => Window | null | undefined,
  handler: (message: PreviewToEditorMessage) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    const source = getSource();
    if (!source || event.source !== source) return;
    if (!isPreviewMessage(event.data)) return;
    handler(event.data);
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

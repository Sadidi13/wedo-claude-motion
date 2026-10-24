/**
 * postMessage plumbing between the editor and the preview iframe
 * (CONTRACTS.md §3). Incoming messages are validated structurally
 * (`isEditorMessage`) and only accepted from our own origin; outgoing
 * messages are posted to `window.parent` with our origin as target.
 *
 * A tiny inline script in page.tsx buffers messages that arrive before React
 * has hydrated (the editor may post `load` as soon as the iframe fires `load`);
 * `drainQueuedMessages` replays them once the real listener is attached.
 */

import type { EditorToPreviewMessage, PreviewToEditorMessage } from "@/lib/types";
import { isProjectLike } from "./guards";

export function isEditorMessage(data: unknown): data is EditorToPreviewMessage {
  if (typeof data !== "object" || data === null) return false;
  const message = data as Record<string, unknown>;
  switch (message.type) {
    case "load":
      return isProjectLike(message.project) && (message.time === undefined || typeof message.time === "number");
    case "seek":
      return typeof message.time === "number" && Number.isFinite(message.time);
    case "getLayerRects":
      return true;
    case "highlight":
      return message.id === null || typeof message.id === "string";
    case "setTransparent":
      return typeof message.transparent === "boolean";
    case "playback":
      return typeof message.playing === "boolean" && typeof message.muted === "boolean";
    case "motionOverride":
      return typeof message.id === "string" && (message.motion === null || typeof message.motion === "string");
    default:
      return false;
  }
}

export function postToEditor(message: PreviewToEditorMessage): void {
  if (typeof window === "undefined" || window.parent === window) return;
  window.parent.postMessage(message, window.location.origin);
}

/** Globals written by the pre-hydration buffer script (see page.tsx). */
interface QueueWindow {
  __motionPreviewQueue?: MessageEvent[];
  __motionPreviewListening?: boolean;
}

/** Source text of the buffer script; kept here next to the code that drains it. */
export const PRE_HYDRATION_QUEUE_SCRIPT =
  '(function(){var q=[];window.__motionPreviewQueue=q;window.addEventListener("message",function(e){if(!window.__motionPreviewListening){q.push(e)}})})();';

export function drainQueuedMessages(handler: (event: MessageEvent) => void): void {
  const w = window as unknown as QueueWindow;
  w.__motionPreviewListening = true;
  const queued = w.__motionPreviewQueue ?? [];
  w.__motionPreviewQueue = [];
  for (const event of queued) handler(event);
}

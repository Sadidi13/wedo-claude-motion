"use client";
/**
 * The client side of /preview (CONTRACTS.md §3). Decides the mode from the
 * query string + iframe-ness, sets the runtime globals, then:
 *
 *   embed       waits for `load` postMessages from the editor and answers the
 *               rest of the protocol (seek / getLayerRects / highlight /
 *               setTransparent), posts `select` on clicks and `ready` /
 *               `layerRects` / `error` / `warning` back.
 *   ?job=<id>   fetches /api/export/<id>/project and loads it (export path,
 *               normally combined with ?__render=1 and maybe ?transparent=1).
 *   standalone  loads the editor's last autosaved project from localStorage.
 *
 * A new project is loaded into a fresh mount element next to the current one
 * and only replaces it once the first frame rendered, so a broken edit leaves
 * the previous good frame on screen.
 */

import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { loadProject } from "@/lib/loader";
import type { EditorToPreviewMessage, Project, StageMeta } from "@/lib/types";
import { parseMotion } from "@/lib/motion/keyframes";
import { setAudioPlayback } from "@/runtime/audio";
import { setMotionOverride } from "@/runtime/layerMotion";
import { clamp } from "@/runtime/easing";
import { motionWindow } from "@/runtime/globals";
import { toOverlayBox, type OverlayBox } from "./geometry";
import { isProjectLike } from "./guards";
import { HighlightOverlay } from "./HighlightOverlay";
import { drainQueuedMessages, isEditorMessage, postToEditor } from "./messaging";
import { applyDocumentMode, detectPreviewMode, type PreviewMode } from "./mode";
import { findLayerIdInPath } from "./selection";
import { readLastProject } from "./storage";

interface MountedProject {
  el: HTMLDivElement;
  unmount: () => void;
}

/**
 * Sprite wrappers cover the whole stage (position:absolute; inset:0), so without this a click
 * would always hit the top-most sprite. Letting clicks fall through the wrappers to their
 * content gives "the deepest layer under the pointer". Zero specificity so project CSS wins.
 */
const HIT_TEST_CSS = `
:where([data-stage] [data-sprite]) > * { pointer-events: auto; }
:where([data-stage] [data-sprite]) { pointer-events: none; }
`;

function describeError(error: unknown): { message: string; stack?: string } {
  return error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
}

/** Make runtime errors visible to the headless export renderer (window.__renderError). */
function exposeRenderError(message: string): void {
  (window as unknown as { __renderError?: string }).__renderError = message;
}

// "Are we inside an iframe?" never changes, but it is only knowable in the browser:
// a null server snapshot keeps the mode undecided until the client renders.
const subscribeNever = () => () => {};
const getInIframe = () => window.parent !== window;
const getInIframeOnServer = () => null;

export default function PreviewHost() {
  const params = useSearchParams();
  const job = params.get("job");
  const renderParam = params.get("__render") === "1";
  const transparentParam = params.get("transparent") === "1";

  const hostRef = useRef<HTMLDivElement>(null);
  const mountsRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef<MountedProject | null>(null);
  const loadQueueRef = useRef<Promise<void>>(Promise.resolve());
  const modeRef = useRef<PreviewMode | null>(null);
  const lastTimeRef = useRef(0);
  const transparentRef = useRef(transparentParam);
  const highlightRef = useRef<string | null>(null);

  const [meta, setMeta] = useState<StageMeta | null>(null);
  const [overlay, setOverlay] = useState<OverlayBox | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 1. Mode + runtime globals. This effect is declared first so it runs before the
  //    effects below that may load a project.
  const inIframe = useSyncExternalStore(subscribeNever, getInIframe, getInIframeOnServer);
  const mode: PreviewMode | null = inIframe === null ? null : detectPreviewMode({ render: renderParam, inIframe });
  useEffect(() => {
    modeRef.current = mode;
    if (mode !== null) applyDocumentMode(mode);
  }, [mode]);

  const refreshOverlay = useCallback(() => {
    const host = hostRef.current;
    const id = highlightRef.current;
    const w = motionWindow();
    const stage = mountedRef.current?.el.querySelector<HTMLElement>("[data-stage]");
    const rect = id ? w?.__getLayerRects?.().find((r) => r.id === id) : undefined;
    if (!host || !stage || !rect || !w?.__videoMeta || modeRef.current === "render") {
      setOverlay(null);
      return;
    }
    setOverlay(toOverlayBox(rect, stage.getBoundingClientRect(), host.getBoundingClientRect(), w.__videoMeta.width));
  }, []);

  const postRects = useCallback(() => {
    postToEditor({ type: "layerRects", rects: motionWindow()?.__getLayerRects?.() ?? [] });
  }, []);

  // 2. Loading (serialised: a second `load` waits for the first to settle).
  const load = useCallback(
    (project: Project, time?: number): Promise<void> => {
      const run = async () => {
        const mounts = mountsRef.current;
        if (!mounts) return;
        const el = document.createElement("div");
        el.dataset.previewMount = "";
        if (modeRef.current !== "standalone") Object.assign(el.style, { position: "absolute", left: "0", top: "0" });
        mounts.appendChild(el);
        try {
          const result = await loadProject(project, el, {
            transparent: transparentRef.current,
            onError: (error) => {
              exposeRenderError(error.message);
              postToEditor({ type: "error", ...error });
            },
            onWarning: (message) => postToEditor({ type: "warning", message }),
          });
          const previous = mountedRef.current;
          mountedRef.current = { el, unmount: result.unmount };
          previous?.unmount();
          previous?.el.remove();
          setMeta(result.meta);
          setNotice(null);
          const t = clamp(time ?? lastTimeRef.current, 0, result.meta.duration);
          motionWindow()?.__seek?.(t);
          lastTimeRef.current = t;
          postToEditor({ type: "ready", meta: result.meta });
          postRects();
          refreshOverlay();
        } catch (error) {
          el.remove();
          console.error("[preview] failed to load project:", error);
          exposeRenderError(describeError(error).message);
          postToEditor({ type: "error", ...describeError(error) });
          if (window.parent === window) setNotice(describeError(error).message);
        }
      };
      loadQueueRef.current = loadQueueRef.current.then(run, run);
      return loadQueueRef.current;
    },
    [postRects, refreshOverlay],
  );

  // 3. Editor protocol.
  const handleMessage = useCallback(
    (message: EditorToPreviewMessage) => {
      const w = motionWindow();
      switch (message.type) {
        case "load":
          void load(message.project, message.time);
          break;
        case "seek":
          w?.__seek?.(message.time);
          lastTimeRef.current = message.time;
          refreshOverlay();
          postRects();
          break;
        case "getLayerRects":
          postRects();
          break;
        case "highlight":
          highlightRef.current = message.id;
          refreshOverlay();
          break;
        case "setTransparent":
          transparentRef.current = message.transparent;
          w?.__setTransparent?.(message.transparent);
          break;
        case "playback":
          setAudioPlayback({ playing: message.playing, muted: message.muted });
          break;
        case "motionOverride":
          setMotionOverride(message.id, message.motion === null ? undefined : (parseMotion(message.motion) ?? null));
          refreshOverlay();
          postRects();
          break;
      }
    },
    [load, postRects, refreshOverlay],
  );

  useEffect(() => {
    if (mode === null) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!isEditorMessage(event.data)) return;
      handleMessage(event.data);
    };
    window.addEventListener("message", onMessage);
    drainQueuedMessages(onMessage);
    window.addEventListener("resize", refreshOverlay);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("resize", refreshOverlay);
    };
  }, [mode, handleMessage, refreshOverlay]);

  // 4. Export job / standalone bootstrap (embed mode waits for a `load` message instead).
  useEffect(() => {
    if (mode === null) return;
    let cancelled = false;
    const bootstrap = async (): Promise<string | null> => {
      if (job) {
        const response = await fetch(`/api/export/${encodeURIComponent(job)}/project`);
        if (!response.ok) throw new Error(`Could not fetch project for job ${job} (HTTP ${response.status})`);
        const data: unknown = await response.json();
        if (!isProjectLike(data)) throw new Error(`Project JSON for job ${job} has an unexpected shape`);
        if (!cancelled) await load(data, 0);
        return null;
      }
      if (mode !== "standalone") return null;
      const saved = readLastProject();
      if (!saved) return "Nothing to preview: open this page from the editor, or pass ?job=<export job id>.";
      await load(saved, 0);
      return null;
    };
    bootstrap().then(
      (hint) => {
        if (!cancelled && hint) setNotice(hint);
      },
      (error: unknown) => {
        if (cancelled) return;
        console.error("[preview] bootstrap failed:", error);
        setNotice(describeError(error).message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [mode, job, load]);

  // Unmount the project when the page goes away.
  useEffect(
    () => () => {
      mountedRef.current?.unmount();
      mountedRef.current = null;
    },
    [],
  );

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (mode !== "embed") return;
    const stage = mountedRef.current?.el.querySelector("[data-stage]");
    if (!stage || !(event.target instanceof Node) || !stage.contains(event.target)) return;
    postToEditor({ type: "select", id: findLayerIdInPath(event.nativeEvent.composedPath(), stage) });
  };

  const hostStyle: CSSProperties =
    mode === "standalone"
      ? { position: "relative" }
      : { position: "relative", width: meta?.width ?? 0, height: meta?.height ?? 0 };

  return (
    <>
      {mode === "embed" && <style>{HIT_TEST_CSS}</style>}
      <div ref={hostRef} data-preview-host="" style={hostStyle} onPointerDown={onPointerDown}>
        <div ref={mountsRef} data-preview-mounts="" />
        {mode !== "render" && overlay && <HighlightOverlay box={overlay} />}
      </div>
      {notice && (
        <pre
          data-preview-notice=""
          style={{
            margin: 16,
            padding: 12,
            whiteSpace: "pre-wrap",
            fontFamily: "ui-monospace, monospace",
            fontSize: 12,
            color: "#fca5a5",
            background: "#1f1317",
            border: "1px solid #7f1d1d",
            borderRadius: 6,
          }}
        >
          {notice}
        </pre>
      )}
    </>
  );
}

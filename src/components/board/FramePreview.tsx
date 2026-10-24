"use client";
/**
 * One frame of a scene, live: a /preview iframe (embed mode, the same page the
 * canvas and the exporter use) loaded with a small project built from `code`,
 * scaled to the card's width and held at `time`. Hovering plays the scene from
 * the start, so style frames with a little motion can be judged; leaving
 * returns to the key frame. Used by the storyboard view for style frames and
 * shot sketches (docs/STORYBOARD.md); rendering happens in the browser, so it
 * costs no Claude usage.
 */
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createBlankProject } from "@/lib/importer";
import { textFile, fileKindFor } from "@/lib/importer/files";
import type { Project, StageMeta } from "@/lib/types";
import { createPreviewBridge, listenToPreview, type PreviewBridge } from "@/store/previewBridge";
import { useResizeObserver } from "../hooks/useResizeObserver";

interface FramePreviewProps {
  code: string;
  files?: { path: string; content: string }[];
  meta: StageMeta;
  time: number;
  label: string;
  /** play on hover (default true) */
  playable?: boolean;
}

function frameProject(code: string, files: FramePreviewProps["files"], meta: StageMeta, label: string): Project {
  const blank = createBlankProject(meta, label);
  const table = { ...blank.files };
  for (const file of files ?? []) {
    const kind = fileKindFor(file.path);
    table[file.path] = textFile(file.path, kind && kind !== "asset" ? kind : "js", file.content);
  }
  table[blank.entry] = textFile(blank.entry, "jsx", code);
  return { ...blank, files: table };
}

export function FramePreview({ code, files, meta, time, label, playable = true }: FramePreviewProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<PreviewBridge | null>(null);
  const size = useResizeObserver(boxRef);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const playRef = useRef<number | null>(null);
  const project = useMemo(() => frameProject(code, files, meta, label), [code, files, meta, label]);
  const duration = useRef(meta.duration);
  // What the preview last reported, for which load: anything else is still loading.
  const loadKey = `${project.id}@${time}`;
  const loadKeyRef = useRef(loadKey);
  const timeRef = useRef(time);
  const [result, setResult] = useState<{ key: string; state: "ready" | "error" } | null>(null);
  const state = result?.key === loadKey ? result.state : "loading";

  useEffect(() => {
    const getWindow = () => iframeRef.current?.contentWindow;
    const bridge = createPreviewBridge(getWindow);
    bridgeRef.current = bridge;
    const unlisten = listenToPreview(getWindow, (message) => {
      if (message.type === "ready") {
        duration.current = message.meta.duration;
        bridge.seek(timeRef.current);
        setResult({ key: loadKeyRef.current, state: "ready" });
      } else if (message.type === "error") {
        setResult({ key: loadKeyRef.current, state: "error" });
      }
    });
    return () => {
      unlisten();
      bridgeRef.current = null;
    };
  }, []);

  useEffect(() => {
    loadKeyRef.current = loadKey;
    timeRef.current = time;
    if (frameLoaded) bridgeRef.current?.load(project, time);
  }, [frameLoaded, project, time, loadKey]);

  const stop = () => {
    if (playRef.current !== null) cancelAnimationFrame(playRef.current);
    playRef.current = null;
  };
  useEffect(() => stop, []);

  const onEnter = () => {
    if (!playable || state !== "ready") return;
    stop();
    const started = performance.now();
    const tick = (now: number) => {
      const total = Math.max(0.1, duration.current);
      bridgeRef.current?.seek(((now - started) / 1000) % total);
      playRef.current = requestAnimationFrame(tick);
    };
    playRef.current = requestAnimationFrame(tick);
  };
  const onLeave = () => {
    stop();
    bridgeRef.current?.seek(time);
  };

  const scale = size.width > 0 ? size.width / meta.width : 0;
  return (
    <div
      ref={boxRef}
      className="relative w-full overflow-hidden rounded-md bg-[#0c0e13]"
      style={{ aspectRatio: `${meta.width} / ${meta.height}` }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      title={playable ? "Hover to play" : undefined}
    >
      {scale > 0 && (
        <iframe
          ref={iframeRef}
          title={label}
          src="/preview"
          tabIndex={-1}
          onLoad={() => setFrameLoaded(true)}
          width={meta.width}
          height={meta.height}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: meta.width,
            height: meta.height,
            transform: `scale(${scale})`,
            transformOrigin: "0 0",
            border: 0,
            pointerEvents: "none",
            background: "transparent",
            colorScheme: "normal",
          }}
        />
      )}
      {state === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-muted">
          <LoaderCircle size={18} className="animate-spin" />
        </div>
      )}
      {state === "error" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 text-[11px] text-danger">
          <TriangleAlert size={14} /> This frame could not render
        </div>
      )}
    </div>
  );
}

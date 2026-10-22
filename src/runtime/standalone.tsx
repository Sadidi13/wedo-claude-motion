"use client";
/**
 * Chrome used by <Stage> only in STANDALONE mode (the runtime opened outside
 * the editor iframe and outside the export renderer): scale-to-fit wrapper,
 * a minimal scrubber under the stage and keyboard shortcuts
 * (space = play/pause, ←/→ = one frame, shift+←/→ = one second, home/end).
 */

import { useEffect, useState, type ReactNode } from "react";
import type { StageMeta } from "@/lib/types";
import type { TimelineState } from "./motion";

const VIEWPORT_PADDING_X = 32;
const VIEWPORT_PADDING_Y = 96;

function useFitScale(width: number, height: number): number {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const update = () => {
      const availableW = Math.max(1, window.innerWidth - VIEWPORT_PADDING_X);
      const availableH = Math.max(1, window.innerHeight - VIEWPORT_PADDING_Y);
      setScale(Math.max(0.05, Math.min(availableW / width, availableH / height)));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [width, height]);
  return scale;
}

function useKeyboardShortcuts(timeline: TimelineState): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const frame = 1 / timeline.fps;
      const step = event.shiftKey ? 1 : frame;
      switch (event.key) {
        case " ":
          event.preventDefault();
          timeline.setPlaying(!timeline.playing);
          break;
        case "ArrowLeft":
          event.preventDefault();
          timeline.setPlaying(false);
          timeline.setTime(timeline.time - step);
          break;
        case "ArrowRight":
          event.preventDefault();
          timeline.setPlaying(false);
          timeline.setTime(timeline.time + step);
          break;
        case "Home":
          timeline.setTime(0);
          break;
        case "End":
          timeline.setPlaying(false);
          timeline.setTime(timeline.duration);
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [timeline]);
}

export interface StandaloneFrameProps {
  meta: StageMeta;
  timeline: TimelineState;
  children: ReactNode;
}

export function StandaloneFrame({ meta, timeline, children }: StandaloneFrameProps) {
  const scale = useFitScale(meta.width, meta.height);
  useKeyboardShortcuts(timeline);
  const scaledWidth = meta.width * scale;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: 16 }}>
      <div style={{ width: scaledWidth, height: meta.height * scale }}>
        <div style={{ width: meta.width, height: meta.height, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          {children}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: scaledWidth,
          fontFamily: "system-ui, sans-serif",
          fontSize: 12,
          color: "#cbd5e1",
        }}
      >
        <button
          type="button"
          onClick={() => timeline.setPlaying(!timeline.playing)}
          style={{
            minWidth: 56,
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid #3b4252",
            background: "#1f2430",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          {timeline.playing ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          min={0}
          max={meta.duration}
          step={1 / meta.fps}
          value={timeline.time}
          onChange={(event) => {
            timeline.setPlaying(false);
            timeline.setTime(Number(event.target.value));
          }}
          style={{ flex: 1 }}
          aria-label="Timeline"
        />
        <span style={{ fontVariantNumeric: "tabular-nums", minWidth: 96, textAlign: "right" }}>
          {timeline.time.toFixed(2)} / {meta.duration.toFixed(2)} s
        </span>
      </div>
    </div>
  );
}

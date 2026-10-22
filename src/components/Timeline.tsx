"use client";
/**
 * Timeline (bottom): transport bar, a time ruler with second labels and
 * frame ticks, a draggable playhead, and one track row per visible layer in
 * the same order as the Layers panel (`flattenLayers`, collapsed children
 * hidden). One scroll container holds both the sticky name column and the
 * tracks so they scroll together; Ctrl+wheel (or the slider) zooms between 40
 * and 400 px per second.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import type { LayerNode } from "@/lib/types";
import { useEditorStore } from "@/store/editorStore";
import { dragBoundsFor, flattenLayers } from "@/store/layerRows";
import { clamp, formatSeconds, rulerStep, snapToFrame } from "@/store/time";
import { TimelineTrack } from "./TimelineTrack";
import { Transport } from "./Transport";
import { cx } from "./ui/cx";

const NAMES_WIDTH = 220;
const ROW_HEIGHT = 26;
const RULER_HEIGHT = 28;
const PPS_MIN = 40;
const PPS_MAX = 400;
const PPS_DEFAULT = 100;
const END_PADDING_PX = 160;

const EMPTY_LAYERS: LayerNode[] = [];
const EMPTY_BY_ID: Record<string, LayerNode> = {};

export function Timeline() {
  const { layers, byId, collapsed, selectedId, time, duration, fps, hasProject } = useEditorStore(
    useShallow((s) => ({
      layers: s.scene?.layers ?? EMPTY_LAYERS,
      byId: s.scene?.byId ?? EMPTY_BY_ID,
      collapsed: s.collapsed,
      selectedId: s.selectedId,
      time: s.time,
      duration: s.scene?.meta.duration ?? s.project?.meta.duration ?? 0,
      fps: s.scene?.meta.fps ?? s.project?.meta.fps ?? 30,
      hasProject: s.project !== null,
    })),
  );
  const rows = useMemo(() => flattenLayers(layers, collapsed), [layers, collapsed]);
  const [pps, setPps] = useState(PPS_DEFAULT);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const scrubbingRef = useRef(false);

  const trackWidth = Math.max(240, duration * pps + END_PADDING_PX);
  const step = rulerStep(pps);
  const frameWidth = pps / fps;
  const labels = useMemo(() => {
    const out: number[] = [];
    for (let t = 0; t <= duration + 1e-9; t += step) out.push(Number(t.toFixed(4)));
    return out;
  }, [duration, step]);

  // Ctrl/Cmd + wheel zooms; must be a non-passive native listener to stop the browser zoom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      setPps((current) => clamp(Math.round(current * (event.deltaY < 0 ? 1.15 : 1 / 1.15)), PPS_MIN, PPS_MAX));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Keep the playhead in view (DOM scroll only, no state).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const x = time * pps;
    const viewWidth = el.clientWidth - NAMES_WIDTH;
    if (viewWidth <= 0) return;
    if (x < el.scrollLeft || x > el.scrollLeft + viewWidth - 16) {
      el.scrollLeft = Math.max(0, x - viewWidth * 0.15);
    }
  }, [time, pps]);

  const seekFromPointer = (event: ReactPointerEvent) => {
    const ruler = rulerRef.current;
    if (!ruler) return;
    const x = event.clientX - ruler.getBoundingClientRect().left;
    useEditorStore.getState().seek(snapToFrame(clamp(x / pps, 0, duration), fps));
  };
  const onRulerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubbingRef.current = true;
    useEditorStore.getState().pause();
    seekFromPointer(event);
  };
  const onRulerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (scrubbingRef.current) seekFromPointer(event);
  };
  const onRulerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    scrubbingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const rulerBackground = [
    frameWidth >= 5 ? `linear-gradient(90deg, var(--border) 0 1px, transparent 1px) 0 100% / ${frameWidth}px 6px repeat-x` : null,
    `linear-gradient(90deg, var(--border-strong) 0 1px, transparent 1px) 0 100% / ${step * pps}px 12px repeat-x`,
  ]
    .filter(Boolean)
    .join(", ");
  const trackBackground = `linear-gradient(90deg, var(--border) 0 1px, transparent 1px) 0 0 / ${Math.max(1, pps)}px 100% repeat-x`;
  const playheadX = NAMES_WIDTH + time * pps;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Transport pxPerSecond={pps} min={PPS_MIN} max={PPS_MAX} onZoom={setPps} />
      <div ref={scrollRef} className="ms-scroll relative min-h-0 flex-1 overflow-auto" role="region" aria-label="Timeline tracks">
        <div className="relative" style={{ width: NAMES_WIDTH + trackWidth, minWidth: "100%" }}>
          {/* ruler row (sticky top) */}
          <div className="sticky top-0 z-30 flex" style={{ height: RULER_HEIGHT }}>
            <div className="sticky left-0 z-40 flex shrink-0 items-center border-b border-r border-border bg-panel px-2 text-[11px] font-semibold uppercase tracking-wide text-muted" style={{ width: NAMES_WIDTH }}>
              Tracks <span className="ml-1 font-mono font-normal normal-case">{rows.length}</span>
            </div>
            <div
              ref={rulerRef}
              role="slider"
              aria-label="Playhead"
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={time}
              tabIndex={-1}
              onPointerDown={onRulerDown}
              onPointerMove={onRulerMove}
              onPointerUp={onRulerUp}
              onPointerCancel={onRulerUp}
              className="relative cursor-ew-resize border-b border-border bg-panel-2 select-none"
              style={{ width: trackWidth, background: rulerBackground, backgroundColor: "var(--panel-2)" }}
            >
              {labels.map((t) => (
                <span key={t} className="absolute top-1 font-mono text-[10px] tabular-nums text-muted" style={{ left: t * pps + 3 }}>
                  {formatSeconds(t)}s
                </span>
              ))}
              <span
                aria-hidden
                className="pointer-events-none absolute bottom-0 h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[8px] border-x-transparent border-t-accent-2"
                style={{ left: time * pps }}
              />
            </div>
          </div>

          {/* rows */}
          {!hasProject && <p className="px-3 py-2 text-muted">Loading project…</p>}
          {rows.map((row) => {
            const { node } = row;
            const selected = node.id === selectedId;
            return (
              <div key={node.id} className={cx("flex", selected ? "bg-accent/10" : "odd:bg-panel-2/40")} style={{ height: ROW_HEIGHT }}>
                <div
                  className={cx(
                    "sticky left-0 z-20 flex shrink-0 cursor-default items-center gap-1 border-b border-r border-border bg-panel pr-2 text-[11.5px]",
                    selected && "text-foreground",
                    node.hidden && "opacity-50",
                  )}
                  style={{ width: NAMES_WIDTH, paddingLeft: 8 + row.depth * 12 }}
                  onClick={() => useEditorStore.getState().select(node.id)}
                  title={`${node.name} <${node.tag}>`}
                >
                  <span className={cx("h-2 w-2 shrink-0 rounded-sm", node.kind === "sprite" ? "bg-accent" : "bg-border-strong")} />
                  <span className="truncate">{node.name}</span>
                </div>
                <div className="relative border-b border-border/60" style={{ width: trackWidth, background: trackBackground }}>
                  <TimelineTrack
                    node={node}
                    bounds={dragBoundsFor(byId, node, duration)}
                    duration={duration}
                    fps={fps}
                    pxPerSecond={pps}
                    width={trackWidth}
                    selected={selected}
                  />
                </div>
              </div>
            );
          })}

          {/* playhead line (under the sticky name column, above the tracks) */}
          <div aria-hidden className="pointer-events-none absolute bottom-0 z-10 w-px bg-accent-2" style={{ left: playheadX, top: RULER_HEIGHT }} />
        </div>
      </div>
    </div>
  );
}

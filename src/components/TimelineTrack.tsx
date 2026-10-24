"use client";
/**
 * One timeline row's track cell. Sprites with literal timing get a clip bar
 * that can be moved (body) or trimmed (edge handles): the drag is previewed
 * locally, snapped to frames and clamped to the parent window, and committed
 * once on pointer-up as a single `setTiming` call (one history entry).
 * Audio clips (<Audio>) get the same draggable bar in green. A layer's
 * keyframes (data-motion) show as diamonds; clicking one moves the playhead there. Dynamic-timing
 * Sprites show a read-only bar with an "expr" badge; other layers show a
 * hatched bar over their inherited range and a "Wrap in Sprite" action on hover.
 */
import { Clapperboard, Volume2 } from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { LayerNode } from "@/lib/types";
import { useEditorStore } from "@/store/editorStore";
import { keyTimes } from "@/lib/motion/keyframes";
import { hasLiteralTiming, isTimed, motionClockStart } from "@/store/layerRows";
import { formatSeconds, resolveClipDrag, type ClipDragMode } from "@/store/time";
import { cx } from "./ui/cx";

export interface TimelineTrackProps {
  node: LayerNode;
  bounds: { start: number; end: number };
  duration: number;
  fps: number;
  pxPerSecond: number;
  width: number;
  selected: boolean;
}

interface DragState {
  mode: ClipDragMode;
  originX: number;
  start: number;
  end: number;
  latest: { start: number; end: number };
}

export function TimelineTrack({ node, bounds, duration, fps, pxPerSecond, width, selected }: TimelineTrackProps) {
  const literal = hasLiteralTiming(node);
  const sprite = isTimed(node);
  const audio = node.kind === "audio";
  const base = literal
    ? { start: node.start ?? 0, end: Math.min(node.end ?? duration, duration) }
    : { start: node.range.start, end: Math.min(node.range.end, duration) };
  const [draft, setDraft] = useState<{ start: number; end: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const shown = draft ?? base;
  const draggable = literal && !node.locked;
  const keyStart = useEditorStore((s) => (node.motion && s.scene ? motionClockStart(s.scene.byId, node) : 0));
  const keys = keyTimes(node.motion);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    useEditorStore.getState().select(node.id);
    if (!draggable) return;
    const handle = (event.target as HTMLElement).dataset.handle;
    const mode: ClipDragMode = handle === "start" ? "trim-start" : handle === "end" ? "trim-end" : "move";
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { mode, originX: event.clientX, start: base.start, end: base.end, latest: base };
    setDraft(base);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = (event.clientX - drag.originX) / pxPerSecond;
    const next = resolveClipDrag({ mode: drag.mode, start: drag.start, end: drag.end, delta, bounds, fps });
    drag.latest = next;
    setDraft(next);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDraft(null);
    const { latest } = drag;
    if (latest.start !== drag.start || latest.end !== drag.end) {
      useEditorStore.getState().setTiming(node.id, { start: latest.start, end: latest.end });
    }
  };

  const left = shown.start * pxPerSecond;
  const barWidth = Math.max(2, (shown.end - shown.start) * pxPerSecond);
  const dragging = draft !== null;

  return (
    <div
      className="group relative h-full"
      style={{ width }}
      onPointerDown={(event) => {
        if (event.button === 0) useEditorStore.getState().select(node.id);
      }}
    >
      <div
        role="presentation"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        title={`${node.name}: ${formatSeconds(shown.start)}–${formatSeconds(shown.end)}s`}
        className={cx(
          "absolute top-[5px] h-4 rounded-[3px] border text-[10px] leading-[14px]",
          audio && literal && (selected ? "border-success bg-success/70 text-[#0b0d14]" : "border-success/50 bg-success/30 text-foreground"),
          sprite && !audio && literal && (selected ? "border-accent bg-accent/70 text-[#0b0d14]" : "border-accent/50 bg-accent/35 text-foreground"),
          sprite && !literal && (selected ? "border-accent-2 bg-accent-2/60 text-[#0b0d14]" : "border-accent-2/50 bg-accent-2/30 text-foreground"),
          !sprite && cx("ms-hatch border-border-strong/60", selected ? "bg-panel-3" : "bg-panel-2"),
          draggable ? "cursor-grab active:cursor-grabbing" : "cursor-default",
          node.hidden && "opacity-40",
          dragging && "shadow-[0_0_0_2px_var(--accent)]",
        )}
        style={{ left, width: barWidth }}
      >
        {draggable && (
          <>
            <span data-handle="start" className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize rounded-l-[3px] hover:bg-white/30" />
            <span data-handle="end" className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize rounded-r-[3px] hover:bg-white/30" />
          </>
        )}
        <span className="pointer-events-none absolute inset-x-2 flex items-center gap-1 truncate">
          {audio && !dragging && <Volume2 size={10} className="shrink-0" />}
          <span className="truncate">{dragging ? `${formatSeconds(shown.start)} – ${formatSeconds(shown.end)}s` : sprite ? node.name : ""}</span>
        </span>
        {sprite && !literal && (
          <span className="pointer-events-none absolute right-1 top-0 rounded bg-black/30 px-1 font-mono text-[9px]" title="Timing is an expression (read-only)">
            expr
          </span>
        )}
      </div>
      {keys.map((t) => (
        <button
          key={t}
          type="button"
          title={`Keyframe at ${formatSeconds(keyStart + t)}s`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            const store = useEditorStore.getState();
            store.pause();
            store.select(node.id);
            store.seek(keyStart + t);
          }}
          className="absolute top-[8px] z-10 h-[10px] w-[10px] -translate-x-1/2 rotate-45 border border-[#0b0d14] bg-accent-2 hover:scale-125"
          style={{ left: (keyStart + t) * pxPerSecond }}
        />
      ))}
      {!sprite && !node.locked && (
        <button
          type="button"
          title="Wrap in Sprite to retime this layer"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => useEditorStore.getState().wrapInSprite(node.id, node.range.start, Math.min(node.range.end, duration))}
          className="ms-focus absolute top-[5px] hidden h-4 items-center gap-1 rounded-[3px] border border-border-strong bg-panel-3 px-1.5 text-[10px] text-foreground group-hover:inline-flex"
          style={{ left: left + barWidth + 6 }}
        >
          <Clapperboard size={10} /> Wrap in Sprite
        </button>
      )}
    </div>
  );
}

"use client";
/**
 * On-canvas transform handles for the selected layer (docs/TRANSFORM.md):
 * drag the box to move, a corner to scale, the top knob to rotate. Shift keeps
 * a move on one axis and snaps rotation to 15°. While dragging, the preview
 * shows the change live (a motion override sent to the iframe); on release it
 * is written into the scene as the layer's `data-motion`, one undo step. When a
 * property is keyframed, the drag sets the keyframe at the playhead.
 *
 * A Sprite's own box is the whole stage, so for Sprites the handles wrap the
 * Sprite's visible content, and scaling / rotating pivots around its centre.
 */
import { RotateCw } from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { type MotionProp, type MotionSpec, motionAt, serializeMotion, setValue } from "@/lib/motion/keyframes";
import type { LayerNode, LayerRect } from "@/lib/types";
import { useEditorStore } from "@/store/editorStore";
import { motionClockStart } from "@/store/layerRows";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The box the handles wrap, in stage coordinates. */
export function transformBoxFor(node: LayerNode, byId: Record<string, LayerNode>, rects: LayerRect[]): Box | null {
  const own = rects.find((rect) => rect.id === node.id);
  if (node.kind !== "sprite") return own ?? null;
  const descendants = new Set<string>();
  const collect = (n: LayerNode) => {
    for (const child of n.children) {
      descendants.add(child.id);
      collect(child);
    }
  };
  collect(node);
  let box: Box | null = null;
  for (const rect of rects) {
    if (!descendants.has(rect.id) || rect.visible === false || rect.width <= 0 || rect.height <= 0) continue;
    if (byId[rect.id]?.kind === "sprite") continue;
    if (!box) box = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    else {
      const right = Math.max(box.x + box.width, rect.x + rect.width);
      const bottom = Math.max(box.y + box.height, rect.y + rect.height);
      box = { x: Math.min(box.x, rect.x), y: Math.min(box.y, rect.y), width: 0, height: 0 };
      box.width = right - box.x;
      box.height = bottom - box.y;
    }
  }
  return box ?? own ?? null;
}

type Mode = "move" | "scale" | "rotate";

interface Drag {
  mode: Mode;
  pointerX: number;
  pointerY: number;
  /** screen centre of the box */
  centerX: number;
  centerY: number;
  startDistance: number;
  startAngle: number;
  spec: MotionSpec;
  base: ReturnType<typeof motionAt>;
  local: number;
  next: MotionSpec | null;
}

interface TransformBoxProps {
  left: number;
  top: number;
  scale: number;
  onPreview: (id: string, motion: string | null) => void;
}

const HANDLE = 9;

export function TransformBox({ left, top, scale, onPreview }: TransformBoxProps) {
  const { node, byId, rects } = useEditorStore(
    useShallow((s) => ({
      node: s.selectedId ? (s.scene?.byId[s.selectedId] ?? null) : null,
      byId: s.scene?.byId ?? null,
      rects: s.layerRects,
    })),
  );
  const dragRef = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState<Mode | null>(null);

  if (!node || !byId || node.kind === "audio" || node.locked || node.hidden) return null;
  const box = transformBoxFor(node, byId, rects);
  if (!box || box.width <= 0 || box.height <= 0) return null;

  const screen = { left: left + box.x * scale, top: top + box.y * scale, width: box.width * scale, height: box.height * scale };

  const begin = (event: ReactPointerEvent<HTMLElement>) => {
    const mode = event.currentTarget.dataset.mode as Mode | undefined;
    if (event.button !== 0 || !mode) return;
    event.preventDefault();
    event.stopPropagation();
    const store = useEditorStore.getState();
    store.pause();
    const spec: MotionSpec = node.motion ? { ...node.motion } : {};
    const local = store.time - motionClockStart(byId, node);
    const base = motionAt(spec, local);
    const container = event.currentTarget.closest<HTMLElement>("[data-canvas-root]")?.getBoundingClientRect();
    const centerX = (container?.left ?? 0) + screen.left + screen.width / 2;
    const centerY = (container?.top ?? 0) + screen.top + screen.height / 2;
    if (node.kind === "sprite" && spec.ox === undefined && spec.oy === undefined && mode !== "move") {
      // Pivot a stage-sized Sprite around its content (in its own, untranslated coordinates).
      spec.ox = box.x + box.width / 2 - base.x;
      spec.oy = box.y + box.height / 2 - base.y;
    }
    dragRef.current = {
      mode,
      pointerX: event.clientX,
      pointerY: event.clientY,
      centerX,
      centerY,
      startDistance: Math.max(4, Math.hypot(event.clientX - centerX, event.clientY - centerY)),
      startAngle: (Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) / Math.PI,
      spec,
      base,
      local,
      next: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(mode);
  };

  const onMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const set = (spec: MotionSpec, prop: MotionProp, value: number) => setValue(spec, prop, drag.local, value);
    let next = drag.spec;
    if (drag.mode === "move") {
      let dx = (event.clientX - drag.pointerX) / scale;
      let dy = (event.clientY - drag.pointerY) / scale;
      if (event.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      next = set(set(next, "x", Math.round(drag.base.x + dx)), "y", Math.round(drag.base.y + dy));
    } else if (drag.mode === "scale") {
      const distance = Math.hypot(event.clientX - drag.centerX, event.clientY - drag.centerY);
      const value = Math.min(20, Math.max(0.05, drag.base.scale * (distance / drag.startDistance)));
      next = set(next, "scale", Math.round(value * 100) / 100);
    } else {
      const angle = (Math.atan2(event.clientY - drag.centerY, event.clientX - drag.centerX) * 180) / Math.PI;
      let value = drag.base.rotate + angle - drag.startAngle;
      value = event.shiftKey ? Math.round(value / 15) * 15 : Math.round(value * 10) / 10;
      next = set(next, "rotate", value);
    }
    drag.next = next;
    onPreview(node.id, serializeMotion(next) ?? "{}");
  };

  const end = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragging(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag.next) return;
    const before = serializeMotion(node.motion ?? {});
    const after = serializeMotion(drag.next);
    if (before === after) {
      onPreview(node.id, null);
      return;
    }
    // The preview keeps the override until the committed scene reloads (the loader clears it).
    useEditorStore.getState().setMotion(node.id, drag.next);
  };

  const handlers = { onPointerMove: onMove, onPointerUp: end, onPointerCancel: end };
  const corner = (x: "left" | "right", y: "top" | "bottom", cursor: string) => (
    <span
      key={`${x}${y}`}
      role="presentation"
      data-mode="scale"
      onPointerDown={begin}
      {...handlers}
      className="absolute rounded-[2px] border border-[#0b0d14] bg-accent"
      style={{ width: HANDLE, height: HANDLE, [x]: -HANDLE / 2, [y]: -HANDLE / 2, cursor }}
    />
  );

  return (
    <div
      aria-hidden
      className="absolute z-10"
      style={{ ...screen, outline: "1.5px solid var(--accent)" }}
      title="Drag to move · corners scale · top knob rotates (Shift: straight / 15°)"
    >
      <div
        role="presentation"
        data-mode="move"
        onPointerDown={begin}
        {...handlers}
        className="absolute inset-0"
        style={{ cursor: dragging === "move" ? "grabbing" : "move" }}
      />
      {corner("left", "top", "nwse-resize")}
      {corner("right", "top", "nesw-resize")}
      {corner("left", "bottom", "nesw-resize")}
      {corner("right", "bottom", "nwse-resize")}
      <span className="pointer-events-none absolute left-1/2 top-[-22px] h-[14px] w-px bg-accent" />
      <span
        role="presentation"
        data-mode="rotate"
        onPointerDown={begin}
        {...handlers}
        title="Rotate (Shift: 15° steps)"
        className="absolute left-1/2 top-[-34px] flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full border border-[#0b0d14] bg-accent text-[#0b0d14]"
        style={{ cursor: "grab" }}
      >
        <RotateCw size={10} />
      </span>
    </div>
  );
}

"use client";
/**
 * Inspector section for the selected layer's motion (docs/TRANSFORM.md): X, Y,
 * scale, rotation and opacity at the playhead, each with a keyframe button.
 * ◇ starts animating the property with a keyframe at the playhead; ◆ (a key
 * is here) removes it. Editing a value sets the keyframe at the playhead when
 * the property is animated, otherwise the static value. The easing applies to
 * the segments that start at the playhead's keyframes. Every change is one
 * undo step.
 */
import { Diamond, RotateCcw } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import {
  EASING_NAMES,
  type EasingName,
  type MotionProp,
  type MotionSpec,
  MOTION_PROPS,
  addKey,
  isAnimated,
  keyAt,
  motionAt,
  removeKey,
  setKeyEase,
  setValue,
} from "@/lib/motion/keyframes";
import type { LayerNode } from "@/lib/types";
import { useEditorStore } from "@/store/editorStore";
import { motionClockStart } from "@/store/layerRows";
import { Button } from "./ui/Button";
import { cx } from "./ui/cx";
import { NumberField } from "./ui/NumberField";

const ROWS: { prop: MotionProp; label: string; suffix: string; toField: (v: number) => number; fromField: (v: number) => number; step: number; min?: number; max?: number }[] = [
  { prop: "x", label: "X", suffix: "px", toField: (v) => v, fromField: (v) => v, step: 1 },
  { prop: "y", label: "Y", suffix: "px", toField: (v) => v, fromField: (v) => v, step: 1 },
  { prop: "scale", label: "Scale", suffix: "%", toField: (v) => v * 100, fromField: (v) => v / 100, step: 5, min: 1, max: 2000 },
  { prop: "rotate", label: "Rotate", suffix: "°", toField: (v) => v, fromField: (v) => v, step: 5 },
  { prop: "opacity", label: "Opacity", suffix: "%", toField: (v) => v * 100, fromField: (v) => v / 100, step: 5, min: 0, max: 100 },
];

export function TransformSection({ node }: { node: LayerNode }) {
  const { time, byId } = useEditorStore(useShallow((s) => ({ time: s.time, byId: s.scene?.byId ?? null })));
  if (!byId) return null;
  const store = useEditorStore.getState();
  const spec: MotionSpec = node.motion ?? {};
  const local = time - motionClockStart(byId, node);
  const values = motionAt(spec, local);
  const keyedHere = MOTION_PROPS.filter((prop) => keyAt(spec[prop], local));
  const easeHere = keyedHere.length ? (keyAt(spec[keyedHere[0]], local)?.[2] ?? "linear") : null;
  const commit = (next: MotionSpec | null) => store.setMotion(node.id, next);

  return (
    <section className="flex flex-col gap-2.5 border-b border-border px-3 py-3">
      <div className="flex items-center">
        <h3 className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Transform</h3>
        {node.motion && (
          <Button size="sm" variant="ghost" icon={<RotateCcw size={12} />} disabled={node.locked} onClick={() => commit(null)} title="Remove the move, scale, rotation, opacity and keyframes set here">
            Reset
          </Button>
        )}
      </div>
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1.5">
        {ROWS.map((row) => {
          const animated = isAnimated(spec[row.prop]);
          const here = Boolean(keyAt(spec[row.prop], local));
          return (
            <div key={row.prop} className="contents">
              <span className="text-[11.5px] text-muted">{row.label}</span>
              <NumberField
                value={Math.round(row.toField(values[row.prop]) * 100) / 100}
                min={row.min}
                max={row.max}
                step={row.step}
                suffix={row.suffix}
                label={row.label}
                disabled={node.locked}
                onCommit={(value) => commit(setValue(spec, row.prop, local, row.fromField(value)))}
              />
              <button
                type="button"
                disabled={node.locked}
                onClick={() => commit(here ? removeKey(spec, row.prop, local) : addKey(spec, row.prop, local))}
                title={here ? "Remove the keyframe at the playhead" : animated ? "Add a keyframe at the playhead" : "Animate: add a keyframe at the playhead"}
                className={cx(
                  "ms-focus flex h-6 w-6 items-center justify-center rounded hover:bg-panel-3 disabled:opacity-40",
                  here ? "text-accent-2" : animated ? "text-accent" : "text-muted",
                )}
              >
                <Diamond size={12} fill={here ? "currentColor" : "none"} />
              </button>
            </div>
          );
        })}
      </div>
      {easeHere && (
        <label className="flex items-center gap-2 text-[11.5px] text-muted">
          Easing from here
          <select
            className="ms-input ms-focus min-w-0 flex-1"
            value={easeHere}
            disabled={node.locked}
            onChange={(event) => {
              let next = spec;
              for (const prop of keyedHere) next = setKeyEase(next, prop, local, event.target.value as EasingName);
              commit(next);
            }}
          >
            {EASING_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="text-[11px] text-muted">Drag the layer on the canvas to move it; corners scale, the top knob rotates. ◇ animates a value from the playhead.</p>
    </section>
  );
}

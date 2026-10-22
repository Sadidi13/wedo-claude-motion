"use client";
/**
 * Properties tab: the selected layer's name, kind, timing (seconds + frames),
 * hidden / locked flags and quick actions; with nothing selected, the Stage
 * props (size, duration, fps, background) edited through setStageMeta, plus
 * the parser's warnings.
 */
import { Braces, Clapperboard, Copy, Trash2 } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import type { LayerNode, StageMeta } from "@/lib/types";
import { useEditorStore } from "@/store/editorStore";
import { dragBoundsFor, hasLiteralTiming } from "@/store/layerRows";
import { formatRange, toFrame } from "@/store/time";
import { Button } from "./ui/Button";
import { Checkbox } from "./ui/Checkbox";
import { Field } from "./ui/Field";
import { NumberField } from "./ui/NumberField";

/** Stable empty list so the store selector returns a referentially equal snapshot while no scene is parsed. */
const EMPTY_WARNINGS: string[] = [];

interface PropertiesTabProps {
  onOpenCode: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-b border-border px-3 py-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

function NameInput({ initial, onCommit }: { initial: string; onCommit: (name: string) => void }) {
  const [draft, setDraft] = useState(initial);
  const commit = () => {
    if (draft.trim() !== initial) onCommit(draft);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      commit();
      event.currentTarget.blur();
    }
    if (event.key === "Escape") setDraft(initial);
  };
  return (
    <input
      className="ms-input w-full select-text"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      aria-label="Layer name"
      placeholder="Layer name"
    />
  );
}

function LayerProperties({ node, meta, onOpenCode }: { node: LayerNode; meta: StageMeta; onOpenCode: () => void }) {
  const store = useEditorStore.getState();
  const byId = useEditorStore((s) => s.scene?.byId);
  const literal = hasLiteralTiming(node);
  const bounds = byId ? dragBoundsFor(byId, node, meta.duration) : { start: 0, end: meta.duration };
  const frameStep = 1 / meta.fps;
  const start = node.start ?? node.range.start;
  const end = Number.isFinite(node.end ?? Infinity) ? (node.end ?? node.range.end) : node.range.end;

  return (
    <>
      <Section title="Layer">
        <Field label="Name">
          <NameInput key={`${node.id}:${node.name}`} initial={node.name} onCommit={(name) => store.renameLayer(node.id, name)} />
        </Field>
        <div className="flex items-center gap-2 text-[11.5px] text-muted">
          <span className="rounded bg-panel-3 px-1.5 py-0.5 font-medium text-foreground">{node.kind}</span>
          <span className="font-mono">&lt;{node.tag}&gt;</span>
          <span className="ml-auto select-text font-mono text-[10.5px]" title="data-layer-id">
            {node.id}
          </span>
        </div>
        {node.textPreview && (
          <p className="truncate text-[11.5px] text-muted" title={node.textPreview}>
            “{node.textPreview}”
          </p>
        )}
      </Section>

      <Section title="Timing">
        {node.kind === "sprite" && literal && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Start">
                <NumberField
                  value={start}
                  min={bounds.start}
                  max={end - frameStep}
                  step={frameStep}
                  suffix={`f${toFrame(start, meta.fps)}`}
                  disabled={node.locked}
                  onCommit={(value) => store.setTiming(node.id, { start: value })}
                />
              </Field>
              <Field label="End">
                <NumberField
                  value={end}
                  min={start + frameStep}
                  max={bounds.end}
                  step={frameStep}
                  suffix={`f${toFrame(end, meta.fps)}`}
                  disabled={node.locked}
                  onCommit={(value) => store.setTiming(node.id, { end: value })}
                />
              </Field>
            </div>
            <p className="text-[11px] text-muted">
              Visible {formatRange(node.range)} · parent window {formatRange(bounds)} · {meta.fps} fps
            </p>
          </>
        )}
        {node.kind === "sprite" && !literal && (
          <p className="text-[11.5px] text-accent-2">
            This Sprite&apos;s timing is an expression and cannot be edited numerically. Change it in the Code tab.
          </p>
        )}
        {node.kind !== "sprite" && (
          <>
            <p className="text-[11.5px] text-muted">Inherits {formatRange(node.range)} from its parent. Wrap it in a Sprite to retime it on its own.</p>
            <Button
              size="sm"
              icon={<Clapperboard size={13} />}
              disabled={node.locked}
              onClick={() => store.wrapInSprite(node.id, node.range.start, Math.min(node.range.end, meta.duration))}
            >
              Wrap in Sprite
            </Button>
          </>
        )}
      </Section>

      <Section title="Visibility">
        <Checkbox label="Hidden (H)" checked={node.hidden} onChange={(hidden) => store.setHidden(node.id, hidden)} />
        <Checkbox label="Locked" checked={node.locked} onChange={(locked) => store.setLocked(node.id, locked)} title="Locked layers cannot be deleted, moved, retimed or rewritten" />
      </Section>

      <Section title="Actions">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" icon={<Braces size={13} />} onClick={onOpenCode} title="Edit this layer's source">
            Open in Code
          </Button>
          <Button size="sm" icon={<Copy size={13} />} onClick={() => store.duplicateLayer(node.id)}>
            Duplicate
          </Button>
          <Button size="sm" variant="danger" icon={<Trash2 size={13} />} disabled={node.locked} onClick={() => store.deleteLayer(node.id)}>
            Delete
          </Button>
        </div>
      </Section>
    </>
  );
}

function StageProperties({ meta, warnings }: { meta: StageMeta; warnings: string[] }) {
  const store = useEditorStore.getState();
  const background = meta.background ?? "";
  const transparent = background.trim() === "";
  const colorValue = /^#[0-9a-f]{6}$/i.test(background.trim()) ? background.trim() : "#000000";

  return (
    <>
      <Section title="Stage">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Width">
            <NumberField value={meta.width} min={16} max={8192} step={1} suffix="px" decimals={0} onCommit={(width) => store.setStageMeta({ width })} />
          </Field>
          <Field label="Height">
            <NumberField value={meta.height} min={16} max={8192} step={1} suffix="px" decimals={0} onCommit={(height) => store.setStageMeta({ height })} />
          </Field>
          <Field label="Duration">
            <NumberField value={meta.duration} min={0.1} max={3600} step={0.1} suffix="s" onCommit={(duration) => store.setStageMeta({ duration })} />
          </Field>
          <Field label="Frame rate">
            <NumberField value={meta.fps} min={1} max={120} step={1} suffix="fps" decimals={0} onCommit={(fps) => store.setStageMeta({ fps })} />
          </Field>
        </div>
        <Field label="Background" hint="Any CSS background (colour or gradient). Empty = transparent.">
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Background colour"
              className="ms-focus h-7 w-9 cursor-pointer rounded border border-border bg-panel p-0.5"
              value={colorValue}
              disabled={transparent}
              onChange={(event) => store.setStageMeta({ background: event.target.value })}
            />
            <input
              key={background}
              className="ms-input min-w-0 flex-1 select-text font-mono"
              defaultValue={background}
              placeholder="transparent"
              aria-label="Background CSS"
              onBlur={(event) => {
                if (event.target.value !== background) store.setStageMeta({ background: event.target.value.trim() });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </div>
          <Checkbox
            label="Transparent stage"
            checked={transparent}
            onChange={(checked) => store.setStageMeta({ background: checked ? "" : "#0b0b12" })}
            className="mt-1"
          />
        </Field>
      </Section>
      {warnings.length > 0 && (
        <Section title={`Warnings (${warnings.length})`}>
          <ul className="flex flex-col gap-1 text-[11px] text-accent-2">
            {warnings.map((warning, index) => (
              <li key={index} className="select-text">
                {warning}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <p className="px-3 py-3 text-[11.5px] text-muted">Select a layer in the panel, the timeline or by clicking the canvas to edit it.</p>
    </>
  );
}

export function PropertiesTab({ onOpenCode }: PropertiesTabProps) {
  const { node, meta, warnings, parseError, hasProject } = useEditorStore(
    useShallow((s) => ({
      node: s.selectedId ? (s.scene?.byId[s.selectedId] ?? null) : null,
      meta: s.scene?.meta ?? null,
      warnings: s.scene?.warnings ?? EMPTY_WARNINGS,
      parseError: s.parseError,
      hasProject: s.project !== null,
    })),
  );

  if (!hasProject) return <p className="px-3 py-3 text-muted">Loading project…</p>;
  if (!meta) {
    return (
      <div className="flex flex-col gap-2 px-3 py-3 text-[11.5px]">
        <p className="text-danger">The scene file does not parse, so there are no layers to inspect.</p>
        <pre className="ms-scroll select-text overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted">{parseError}</pre>
        <Button size="sm" icon={<Braces size={13} />} onClick={onOpenCode}>
          Fix in Code
        </Button>
      </div>
    );
  }
  return node ? <LayerProperties node={node} meta={meta} onOpenCode={onOpenCode} /> : <StageProperties meta={meta} warnings={warnings} />;
}

"use client";
/**
 * Frame comments on the canvas: with comment mode on, a click on the stage
 * drops a pin and opens a box for what should change there. Sending queues an
 * Ask Claude request (the same queue as the Ask Claude tab, docs/CLAUDE-DESKTOP.md)
 * for the layer under the pin, with the time and the point added to the
 * instruction, so Claude knows exactly which moment and spot the designer means.
 * The pin stays while Claude works on it.
 */
import { MessageSquare, Send, X } from "lucide-react";
import { useState, type PointerEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import type { AiEditRequest, LayerRect, ParsedScene } from "@/lib/types";
import { useBridgeStore } from "@/store/bridgeStore";
import { chatKeyFor, errorMessage, useEditorStore } from "@/store/editorStore";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";

interface Draft {
  x: number;
  y: number;
  time: number;
  layerId: string | null;
}

/**
 * The layer a point falls on: the smallest visible rect that contains it (the deepest element,
 * since Sprite wrappers cover the whole stage). Null when only full-stage wrappers contain it.
 */
export function layerAtPoint(rects: LayerRect[], scene: ParsedScene, x: number, y: number): string | null {
  let best: { id: string; area: number } | null = null;
  const stageArea = scene.meta.width * scene.meta.height;
  for (const rect of rects) {
    if (x < rect.x || y < rect.y || x > rect.x + rect.width || y > rect.y + rect.height) continue;
    const node = scene.byId[rect.id];
    if (!node || node.hidden || node.kind === "audio" || rect.visible === false) continue;
    const area = rect.width * rect.height;
    if (area <= 0 || area >= stageArea * 0.98) continue;
    if (!best || area < best.area) best = { id: rect.id, area };
  }
  if (!best) return null;
  // The only element of a Sprite stands for the Sprite (its name, and its timing for Claude to change).
  const node = scene.byId[best.id];
  const parent = node?.parentId ? scene.byId[node.parentId] : undefined;
  if (parent && parent.kind === "sprite" && parent.children.length === 1) return parent.id;
  return best.id;
}

/** The instruction Claude receives: the designer's words plus where and when they pointed. */
export function commentPrompt(text: string, draft: Draft, scene: ParsedScene): string {
  const layer = draft.layerId ? scene.byId[draft.layerId] : null;
  const where = `${Math.round(draft.x)}, ${Math.round(draft.y)} on the ${scene.meta.width}x${scene.meta.height} stage`;
  return `${text.trim()}\n\n(Frame comment at ${draft.time.toFixed(2)}s, at point ${where}${layer ? `, on the layer "${layer.name}"` : ""}.)`;
}

interface CommentLayerProps {
  /** the stage's box on screen, in the canvas container's coordinates */
  left: number;
  top: number;
  scale: number;
  onDone: () => void;
}

export function CommentLayer({ left, top, scale, onDone }: CommentLayerProps) {
  const { scene, project, rects } = useEditorStore(useShallow((s) => ({ scene: s.scene, project: s.project, rects: s.layerRects })));
  const bridgePending = useBridgeStore((s) => s.pending);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  if (!scene || !project) return null;
  const width = scene.meta.width * scale;
  const height = scene.meta.height * scale;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / scale;
    const y = (event.clientY - box.top) / scale;
    useEditorStore.getState().pause();
    const layerId = layerAtPoint(rects, scene, x, y);
    if (layerId) useEditorStore.getState().select(layerId);
    setDraft({ x, y, time: useEditorStore.getState().time, layerId });
    setText("");
    setError(null);
  };

  const send = async () => {
    if (!draft || !text.trim() || sending || useBridgeStore.getState().pending) return;
    const scope = draft.layerId ? "layer" : "scene";
    const key = chatKeyFor(scope, draft.layerId);
    const prompt = commentPrompt(text, draft, scene);
    const request: AiEditRequest = { scope, prompt, project, ...(draft.layerId ? { layerId: draft.layerId } : {}) };
    setSending(true);
    try {
      const response = await fetch("/api/bridge/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const body = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!response.ok || !body?.id) throw new Error(body?.error ?? `Could not send the comment (HTTP ${response.status})`);
      useEditorStore.getState().appendChat(key, { role: "user", content: prompt });
      useBridgeStore.getState().setPending({ id: body.id, scope, layerId: draft.layerId, key, prompt, sentAt: Date.now() });
      setDraft(null);
      onDone();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSending(false);
    }
  };

  const layerName = draft?.layerId ? scene.byId[draft.layerId]?.name : null;
  const boxLeft = draft ? Math.min(Math.max(draft.x * scale + 14, 0), Math.max(0, width - 280)) : 0;
  const boxTop = draft ? Math.min(Math.max(draft.y * scale - 10, 0), Math.max(0, height - 150)) : 0;

  return (
    <div
      className="absolute z-20 cursor-crosshair"
      style={{ left, top, width, height, outline: "2px dashed var(--accent-2)", outlineOffset: 2 }}
      onPointerDown={onPointerDown}
      title="Click where something should change"
    >
      {!draft && (
        <span className="pointer-events-none absolute left-2 top-2 rounded bg-accent-2 px-2 py-0.5 text-[11px] font-medium text-[#0b0d14]">
          Click the spot to comment on (Esc to stop)
        </span>
      )}
      {draft && (
        <>
          <span
            className="pointer-events-none absolute flex h-6 w-6 -translate-x-1/2 -translate-y-full items-center justify-center rounded-full rounded-bl-none bg-accent-2 text-[#0b0d14] shadow-lg"
            style={{ left: draft.x * scale, top: draft.y * scale }}
          >
            <MessageSquare size={12} />
          </span>
          <div
            className="absolute flex w-[270px] cursor-default flex-col gap-1.5 rounded-md border border-border-strong bg-panel-2 p-2 shadow-2xl"
            style={{ left: boxLeft, top: boxTop }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-1 text-[11px] text-muted">
              <span className="min-w-0 flex-1 truncate">
                {draft.time.toFixed(2)}s{layerName ? ` · ${layerName}` : " · whole scene"}
              </span>
              <IconButton size="sm" title="Cancel" onClick={() => setDraft(null)}>
                <X size={12} />
              </IconButton>
            </div>
            <textarea
              autoFocus
              dir="auto"
              rows={3}
              value={text}
              placeholder="What should change here? e.g. make this bigger, move it left, a different colour"
              className="ms-input ms-scroll w-full select-text resize-none leading-[1.45]"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void send();
                if (event.key === "Escape") setDraft(null);
              }}
              aria-label="Comment for Claude"
            />
            {error && <p className="text-[11px] text-danger">{error}</p>}
            {bridgePending && <p className="text-[11px] text-accent-2">Claude is still on the previous request. Send this one when it is done.</p>}
            <div className="flex justify-end">
              <Button
                variant="primary"
                size="sm"
                icon={<Send size={12} />}
                loading={sending}
                disabled={!text.trim() || bridgePending !== null}
                onClick={() => void send()}
              >
                Send to Claude
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

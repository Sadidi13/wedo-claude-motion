"use client";
/**
 * Ask Claude tab: scope (selected layer / whole scene / new scene), prompt
 * (RTL auto-detected) and a per-layer chat thread kept in the store.
 *
 * Two ways to reach Claude:
 *   - Claude Desktop (default): the request is queued on /api/bridge/requests
 *     and answered by a Claude session running `motion-bridge wait`
 *     (docs/CLAUDE-DESKTOP.md). `useBridgeSync` polls it and applies the answer,
 *     so the wait survives switching tabs.
 *   - API key: POST /api/ai/edit, only offered when ANTHROPIC_API_KEY is set.
 *
 * Each reply is applied immediately with history so "Undo" is one click;
 * errors are shown verbatim in the thread.
 */
import { CircleAlert, Send, Sparkles, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { createBlankProject } from "@/lib/importer";
import type { AiEditRequest, AiEditResponse, AiErrorResponse, AiScope, BridgeStatus } from "@/lib/types";
import { applyAiResult } from "@/store/aiApply";
import { isDesktopConnected, useBridgeStore } from "@/store/bridgeStore";
import { chatKeyFor, errorMessage, useEditorStore, type ChatEntry } from "@/store/editorStore";
import { useAiStatus } from "./hooks/useAiStatus";
import { Button } from "./ui/Button";
import { Checkbox } from "./ui/Checkbox";
import { cx } from "./ui/cx";
import { IconButton } from "./ui/IconButton";
import { Segmented, type SegmentedOption } from "./ui/Segmented";

const SCOPES: SegmentedOption<AiScope>[] = [
  { value: "layer", label: "Selected layer", title: "Rewrite only the selected layer" },
  { value: "scene", label: "Whole scene", title: "Rewrite the entire entry file" },
  { value: "new", label: "New scene", title: "Generate a fresh project from the prompt" },
];

type Transport = "desktop" | "api";

function isAiResponse(value: unknown): value is AiEditResponse | AiErrorResponse {
  return typeof value === "object" && value !== null && typeof (value as { ok?: unknown }).ok === "boolean";
}

function Turn({ entry, latest, canUndo }: { entry: ChatEntry; latest: boolean; canUndo: boolean }) {
  const isUser = entry.role === "user";
  const isError = entry.status === "error";
  return (
    <div className={cx("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
      <div
        dir="auto"
        className={cx(
          "max-w-[92%] select-text whitespace-pre-wrap rounded-md px-2.5 py-1.5 text-[12px] leading-[1.45]",
          isUser && "bg-accent/15 text-foreground",
          !isUser && !isError && "bg-panel-3 text-foreground",
          isError && "border border-danger/40 bg-danger/10 text-danger",
        )}
      >
        {isError && <CircleAlert size={13} className="mb-0.5 mr-1 inline" />}
        {entry.content}
      </div>
      {!isUser && entry.status === "applied" && (
        <div className="flex items-center gap-1 text-[11px] text-success">
          Applied ✓
          {latest && (
            <>
              <span className="text-muted">—</span>
              <button
                type="button"
                disabled={!canUndo}
                onClick={() => useEditorStore.getState().undo()}
                className="ms-focus inline-flex items-center gap-0.5 rounded px-1 text-accent hover:bg-panel-3 disabled:opacity-40"
              >
                <Undo2 size={11} /> Undo
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** "Autopilot" when scripts/motion-autopilot.mjs is the listener, otherwise a Claude session. */
function listenerName(status: BridgeStatus | null): string {
  return status?.listenerClient === "headless" ? "Autopilot" : "Claude Desktop";
}

function waitingText(status: BridgeStatus | null, recentlyActive: boolean): string {
  const who = listenerName(status);
  if (status?.listener === "listening") return `Sent to ${who}…`;
  if (status?.listener === "busy") return `${who} is working on it…`;
  if (recentlyActive) return `Queued. ${who} will pick it up as soon as it finishes the previous request.`;
  return "Queued. Nobody is listening yet: start the autopilot (scripts/start-autopilot.cmd), or say “check Motion Studio” in the Claude chat.";
}

export function AskClaudeTab() {
  const status = useAiStatus();
  const { bridgeStatus, bridgeUnreachable, recentlyActive, pending } = useBridgeStore(
    useShallow((s) => ({ bridgeStatus: s.status, bridgeUnreachable: s.unreachable, recentlyActive: s.recentlyActive, pending: s.pending })),
  );
  const { selectedId, selectedName, chat, canUndo, hasScene, project } = useEditorStore(
    useShallow((s) => ({
      selectedId: s.selectedId,
      selectedName: s.selectedId ? (s.scene?.byId[s.selectedId]?.name ?? null) : null,
      chat: s.chat,
      canUndo: s.history.past.length > 0,
      hasScene: s.scene !== null,
      project: s.project,
    })),
  );
  const [scope, setScope] = useState<AiScope>("layer");
  const [prompt, setPrompt] = useState("");
  const [includeFrame, setIncludeFrame] = useState(false);
  const [preferApi, setPreferApi] = useState(false);
  const [apiBusy, setApiBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const apiReady = status.state === "ready";
  const transport: Transport = apiReady && preferApi ? "api" : "desktop";
  const busy = apiBusy || pending !== null;

  const effectiveScope: AiScope = scope === "layer" && !selectedId ? "scene" : scope;
  const key = chatKeyFor(effectiveScope, selectedId);
  const thread = chat[key] ?? [];
  const lastAssistant = [...thread].reverse().find((t) => t.role === "assistant" && t.status === "applied");
  const pendingHere = pending !== null && (pending.key === key || pending.scope === "new");

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length, key, pendingHere]);

  const canSend = !busy && prompt.trim().length > 0 && project !== null && (effectiveScope === "new" || hasScene);

  const sendViaApi = async (request: AiEditRequest): Promise<AiEditResponse | AiErrorResponse> => {
    const response = await fetch("/api/ai/edit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!isAiResponse(body)) throw new Error(`Unexpected response (HTTP ${response.status})`);
    return body;
  };

  const queueForDesktop = async (request: AiEditRequest): Promise<string> => {
    const response = await fetch("/api/bridge/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const body = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
    if (!response.ok || !body?.id) throw new Error(body?.error ?? `Could not queue the request (HTTP ${response.status})`);
    return body.id;
  };

  const send = async () => {
    if (!canSend || !project) return;
    const store = useEditorStore.getState();
    const text = prompt.trim();
    const layerId = effectiveScope === "layer" ? selectedId : null;
    const history = thread.filter((t) => t.status !== "error").map(({ role, content }) => ({ role, content }));
    // TODO(v1): `includeFrame` — the preview iframe cannot hand us a screenshot yet, so no frameImage is sent.
    const request: AiEditRequest = {
      scope: effectiveScope,
      prompt: text,
      project: effectiveScope === "new" ? createBlankProject(store.scene?.meta) : project,
      layerId: layerId ?? undefined,
      history: history.length ? history : undefined,
    };
    const ctx = { scope: effectiveScope, layerId, key, prompt: text };
    if (effectiveScope !== "new") store.appendChat(key, { role: "user", content: text });
    setPrompt("");

    if (transport === "desktop") {
      try {
        const id = await queueForDesktop(request);
        useBridgeStore.getState().setPending({ id, ...ctx, sentAt: Date.now() });
      } catch (error) {
        useEditorStore.getState().appendChat(key, { role: "assistant", content: errorMessage(error), status: "error" });
      }
      return;
    }

    setApiBusy(true);
    try {
      applyAiResult(await sendViaApi(request), ctx);
    } catch (error) {
      useEditorStore.getState().appendChat(key, { role: "assistant", content: errorMessage(error), status: "error" });
    } finally {
      setApiBusy(false);
    }
  };

  const cancelPending = async () => {
    const current = useBridgeStore.getState().pending;
    if (!current) return;
    useBridgeStore.getState().setPending(null);
    await fetch(`/api/bridge/requests/${encodeURIComponent(current.id)}`, { method: "DELETE" }).catch(() => undefined);
    useEditorStore.getState().appendChat(current.scope === "new" ? "scene" : current.key, {
      role: "assistant",
      content: "Cancelled.",
      status: "error",
    });
  };

  const onPromptKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void send();
    }
  };

  const desktopConnected = isDesktopConnected(bridgeStatus);

  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2">
        <Segmented
          block
          size="sm"
          value={effectiveScope}
          onChange={setScope}
          options={SCOPES.map((option) => (option.value === "layer" ? { ...option, disabled: !selectedId } : option))}
        />
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
          <span className="truncate">
            {effectiveScope === "layer" && selectedName ? `Editing “${selectedName}”` : effectiveScope === "scene" ? "Editing the whole scene" : "Generating a new project"}
          </span>
          {transport === "desktop" ? (
            <DesktopPill status={bridgeStatus} unreachable={bridgeUnreachable} recentlyActive={recentlyActive} />
          ) : (
            <ApiPill status={status} />
          )}
        </div>
      </div>

      <div ref={listRef} className="ms-scroll flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto px-3 py-3">
        {thread.length === 0 && !pendingHere && (
          <p className="text-[11.5px] text-muted">
            <Sparkles size={12} className="mr-1 inline text-accent" />
            Describe the change in English or Persian. Claude rewrites {effectiveScope === "layer" ? "only this layer" : "the scene"} and you can undo it.
          </p>
        )}
        {thread.map((entry) => (
          <Turn key={entry.id} entry={entry} latest={entry.id === lastAssistant?.id} canUndo={canUndo} />
        ))}
        {apiBusy && (
          <div className="flex items-center gap-2 text-[11.5px] text-muted">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> Claude is working…
          </div>
        )}
        {pending && (
          <div className="flex items-start gap-2 text-[11.5px] text-muted">
            <span className="mt-1 h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />
            <span className="flex-1">
              {waitingText(bridgeStatus, recentlyActive)}
              {!pendingHere && " (for another layer)"}
            </span>
            <button
              type="button"
              onClick={() => void cancelPending()}
              className="ms-focus inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-accent hover:bg-panel-3"
              title="Cancel this request"
            >
              <X size={11} /> Cancel
            </button>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-border px-3 py-2">
        {transport === "desktop" && bridgeStatus !== null && !desktopConnected && !recentlyActive && !bridgeUnreachable && (
          <p dir="auto" className="rounded border border-accent-2/40 bg-accent-2/10 px-2 py-1 text-[11px] leading-[1.45] text-accent-2">
            Nobody is listening. Start the autopilot by double-clicking{" "}
            <span className="font-medium">scripts/start-autopilot.cmd</span>: it answers every request on its own and costs
            nothing while waiting. Or, in the Claude chat, say <span className="font-medium">“check Motion Studio”</span> after
            sending. Requests you send now wait in the queue.
          </p>
        )}
        {transport === "desktop" && bridgeUnreachable && (
          <p className="text-[11px] text-danger">Could not reach /api/bridge/status. Is the dev server running?</p>
        )}
        {status.state === "error" && transport === "api" && (
          <p className="text-[11px] text-danger">Could not reach /api/ai/status: {status.message}</p>
        )}
        <textarea
          dir="auto"
          rows={3}
          value={prompt}
          placeholder={effectiveScope === "new" ? "e.g. A 6s product teaser with a bold title and three feature cards" : "e.g. Make the title slide in from the left and glow"}
          className="ms-input ms-scroll min-h-[60px] w-full select-text resize-y leading-[1.45]"
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={onPromptKey}
          aria-label="Prompt for Claude"
        />
        <div className="flex items-center gap-2">
          {apiReady ? (
            <Checkbox label="Use API key" checked={preferApi} onChange={setPreferApi} title="Send to the Anthropic API instead of Claude Desktop" />
          ) : (
            <Checkbox
              label="Include current frame"
              checked={includeFrame}
              onChange={setIncludeFrame}
              disabled
              title="Not available yet: the preview cannot capture a screenshot in v1"
            />
          )}
          <div className="flex-1" />
          {thread.length > 0 && (
            <IconButton title="Clear this thread" onClick={() => useEditorStore.getState().clearChat(key)}>
              <Trash2 size={14} />
            </IconButton>
          )}
          <Button variant="primary" size="sm" icon={<Send size={13} />} loading={busy} disabled={!canSend} onClick={() => void send()} title="Send (Ctrl+Enter)">
            Send
          </Button>
        </div>
      </div>
    </>
  );
}

function DesktopPill({ status, unreachable, recentlyActive }: { status: BridgeStatus | null; unreachable: boolean; recentlyActive: boolean }) {
  if (unreachable) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-danger">
        <span className="h-1.5 w-1.5 rounded-full bg-danger" /> server offline
      </span>
    );
  }
  if (!status) return <span className="shrink-0 text-muted">checking…</span>;
  const idle = status.listener === "offline" && recentlyActive;
  const who = listenerName(status);
  const label =
    status.listener === "listening"
      ? who
      : status.listener === "busy"
        ? `${who} · busy`
        : idle
          ? `${who} · between requests`
          : "Claude · offline";
  const dot = status.listener === "busy" || idle ? "bg-accent-2" : status.listener === "offline" ? "bg-muted" : "bg-success";
  return (
    <span
      className={cx("inline-flex shrink-0 items-center gap-1 text-[10.5px]", status.listener === "offline" ? "text-muted" : "text-foreground")}
      title={status.pending ? `${status.pending} request(s) waiting` : undefined}
    >
      <span className={cx("h-1.5 w-1.5 rounded-full", dot)} /> {label}
    </span>
  );
}

function ApiPill({ status }: { status: ReturnType<typeof useAiStatus> }) {
  if (status.state === "loading") return <span className="text-muted">checking…</span>;
  if (status.state === "ready") {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10.5px]" title={`Model: ${status.model}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-success" /> {status.model}
      </span>
    );
  }
  if (status.state === "unconfigured") {
    return (
      <span className="inline-flex items-center gap-1 text-accent-2" title="ANTHROPIC_API_KEY is not set">
        <span className="h-1.5 w-1.5 rounded-full bg-accent-2" /> not configured
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-danger">
      <span className="h-1.5 w-1.5 rounded-full bg-danger" /> offline
    </span>
  );
}

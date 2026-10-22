"use client";
/**
 * Ask Claude tab: scope (selected layer / whole scene / new scene), prompt
 * (RTL auto-detected), POST /api/ai/edit, and a per-layer chat thread kept in
 * the store. Each reply is applied immediately with history so "Undo" is one
 * click; server errors are shown verbatim in the thread.
 */
import { CircleAlert, Send, Sparkles, Trash2, Undo2 } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { createBlankProject } from "@/lib/importer";
import type { AiEditRequest, AiEditResponse, AiErrorResponse, AiScope, Project, ProjectFile } from "@/lib/types";
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

function isAiResponse(value: unknown): value is AiEditResponse | AiErrorResponse {
  return typeof value === "object" && value !== null && typeof (value as { ok?: unknown }).ok === "boolean";
}

function fileKind(path: string): ProjectFile["kind"] {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return ext === "jsx" || ext === "js" || ext === "tsx" || ext === "ts" || ext === "css" || ext === "html" || ext === "json" ? ext : "asset";
}

/** Apply a successful response to the store; throws when the code does not parse. */
function applyResponse(response: AiEditResponse, scope: AiScope, layerId: string | null): void {
  const store = useEditorStore.getState();
  const extraFiles = response.files ?? [];
  if (scope === "layer") {
    if (!layerId || !response.layerCode) throw new Error("The reply did not contain layer code");
    store.replaceLayer(layerId, response.layerCode);
    for (const file of extraFiles) store.updateFile(file.path, file.content);
    return;
  }
  if (!response.sceneCode) throw new Error("The reply did not contain scene code");
  if (scope === "scene") {
    store.setSource(response.sceneCode);
    for (const file of extraFiles) store.updateFile(file.path, file.content);
    return;
  }
  const blank = createBlankProject(store.scene?.meta, "Generated scene");
  const files: Record<string, ProjectFile> = { ...blank.files };
  for (const file of extraFiles) files[file.path] = { path: file.path, kind: fileKind(file.path), content: file.content };
  files[blank.entry] = { path: blank.entry, kind: "jsx", content: response.sceneCode };
  const project: Project = { ...blank, files, origin: "ai-generate" };
  store.loadProject(project);
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

export function AskClaudeTab() {
  const status = useAiStatus();
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
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const effectiveScope: AiScope = scope === "layer" && !selectedId ? "scene" : scope;
  const key = chatKeyFor(effectiveScope, selectedId);
  const thread = chat[key] ?? [];
  const lastAssistant = [...thread].reverse().find((t) => t.role === "assistant" && t.status === "applied");

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length, key]);

  const configured = status.state === "ready";
  const canSend = configured && !busy && prompt.trim().length > 0 && project !== null && (effectiveScope === "new" || hasScene);

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
    if (effectiveScope !== "new") store.appendChat(key, { role: "user", content: text });
    setBusy(true);
    setPrompt("");
    try {
      const response = await fetch("/api/ai/edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!isAiResponse(body)) throw new Error(`Unexpected response (HTTP ${response.status})`);
      const latest = useEditorStore.getState();
      if (!body.ok) {
        latest.appendChat(key, { role: "assistant", content: `${body.error} (${body.code})`, status: "error" });
        return;
      }
      try {
        applyResponse(body, effectiveScope, layerId);
      } catch (applyError) {
        useEditorStore.getState().appendChat(key, {
          role: "assistant",
          content: `${body.summary}\n\nCould not apply the change: ${errorMessage(applyError)}`,
          status: "error",
        });
        return;
      }
      const after = useEditorStore.getState();
      if (effectiveScope === "new") after.appendChat("scene", { role: "user", content: text });
      after.appendChat(effectiveScope === "new" ? "scene" : key, { role: "assistant", content: body.summary, status: "applied" });
    } catch (error) {
      useEditorStore.getState().appendChat(key, { role: "assistant", content: errorMessage(error), status: "error" });
    } finally {
      setBusy(false);
    }
  };

  const onPromptKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void send();
    }
  };

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
        <div className="flex items-center justify-between text-[11px] text-muted">
          <span className="truncate">
            {effectiveScope === "layer" && selectedName ? `Editing “${selectedName}”` : effectiveScope === "scene" ? "Editing the whole scene" : "Generating a new project"}
          </span>
          <StatusPill status={status} />
        </div>
      </div>

      <div ref={listRef} className="ms-scroll flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto px-3 py-3">
        {thread.length === 0 && (
          <p className="text-[11.5px] text-muted">
            <Sparkles size={12} className="mr-1 inline text-accent" />
            Describe the change in English or Persian. Claude rewrites {effectiveScope === "layer" ? "only this layer" : "the scene"} and you can undo it.
          </p>
        )}
        {thread.map((entry) => (
          <Turn key={entry.id} entry={entry} latest={entry.id === lastAssistant?.id} canUndo={canUndo} />
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-[11.5px] text-muted">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> Claude is working…
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-border px-3 py-2">
        {status.state === "unconfigured" && (
          <p className="rounded border border-accent-2/40 bg-accent-2/10 px-2 py-1 text-[11px] text-accent-2">
            Set <code className="font-mono">ANTHROPIC_API_KEY</code> in <code className="font-mono">.env.local</code> and restart the dev server to enable Claude.
          </p>
        )}
        {status.state === "error" && <p className="text-[11px] text-danger">Could not reach /api/ai/status: {status.message}</p>}
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
          <Checkbox
            label="Include current frame"
            checked={includeFrame}
            onChange={setIncludeFrame}
            disabled
            title="Not available yet: the preview cannot capture a screenshot in v1"
          />
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

function StatusPill({ status }: { status: ReturnType<typeof useAiStatus> }) {
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

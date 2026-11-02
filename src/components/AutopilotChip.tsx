"use client";
/**
 * The autopilot's switch in the top bar (docs/CLAUDE-DESKTOP.md). Shows what the background
 * autopilot is doing (from the polled bridge status) and starts, stops or signs it in through
 * /api/bridge/autopilot. Its panel shows the model, the efforts and the last lines of the log, so
 * no console window is needed.
 */
import { Bot, LogIn, Power, PowerOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { AutopilotInfo, AutopilotState } from "@/lib/types";
import { useBridgeStore } from "@/store/bridgeStore";
import { errorMessage, useEditorStore } from "@/store/editorStore";
import { Button } from "./ui/Button";
import { cx } from "./ui/cx";
import { IconButton } from "./ui/IconButton";

const LABELS: Record<AutopilotState, string> = {
  stopped: "Autopilot off",
  starting: "Autopilot starting…",
  "waiting-for-server": "Autopilot waiting…",
  listening: "Autopilot on",
  working: "Autopilot working…",
  "signed-out": "Autopilot · signed out",
  error: "Autopilot · error",
};

const DOTS: Record<AutopilotState, string> = {
  stopped: "bg-muted",
  starting: "animate-pulse bg-accent-2",
  "waiting-for-server": "animate-pulse bg-accent-2",
  listening: "bg-success",
  working: "animate-pulse bg-accent",
  "signed-out": "bg-danger",
  error: "bg-danger",
};

const LOG_LINES = 30;
const LOG_EVERY_MS = 2_500;

type Action = "start" | "stop" | "sign-in";

async function send(action: Action): Promise<AutopilotInfo & { opened?: boolean }> {
  const response = await fetch("/api/bridge/autopilot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const body = (await response.json().catch(() => ({}))) as AutopilotInfo & { error?: string; opened?: boolean };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

/** Show `info` at once instead of waiting for the next status poll. */
function showNow(info: AutopilotInfo): void {
  const { status, setStatus } = useBridgeStore.getState();
  if (status) setStatus({ ...status, autopilot: info });
}

export function AutopilotChip() {
  const { autopilot, chatListening, unreachable } = useBridgeStore(
    useShallow((s) => ({
      autopilot: s.status?.autopilot ?? null,
      chatListening: s.status?.listener === "listening" && s.status.listenerClient !== "headless",
      unreachable: s.unreachable,
    })),
  );
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/bridge/autopilot?log=${LOG_LINES}`, { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as { log?: string[] } | null;
        if (!disposed && body?.log) setLog(body.log);
      } catch {
        // the status poll reports an unreachable server
      }
    };
    void load();
    const timer = setInterval(() => void load(), LOG_EVERY_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [open]);

  if (unreachable || !autopilot) return null;

  const run = async (action: Action) => {
    setBusy(action);
    try {
      const result = await send(action);
      if (action === "sign-in") {
        useEditorStore.getState().setNotice({ kind: "info", message: result.message ?? "Sign in, then start the autopilot again." });
        return;
      }
      showNow(result);
      if (result.message && !result.running) useEditorStore.getState().setNotice({ kind: "warning", message: result.message });
    } catch (error) {
      useEditorStore.getState().setNotice({ kind: "error", message: `Autopilot: ${errorMessage(error)}` });
    } finally {
      setBusy(null);
    }
  };

  const { state, running } = autopilot;
  const title = autopilot.message ? `${LABELS[state]}: ${autopilot.message}` : LABELS[state];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={title}
        aria-expanded={open}
        className={cx(
          "ms-focus flex h-6 items-center gap-1.5 rounded border px-2 text-[11.5px] transition-colors",
          running ? "border-border bg-panel-2 text-foreground hover:bg-panel-3" : "border-border text-muted hover:bg-panel-3 hover:text-foreground",
          (state === "signed-out" || state === "error") && "border-danger/40 text-danger",
        )}
      >
        <Bot size={13} />
        <span className={cx("h-1.5 w-1.5 rounded-full", DOTS[state])} />
        <span className="whitespace-nowrap">{LABELS[state]}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-[420px] max-w-[85vw] rounded-md border border-border bg-panel-2 p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-semibold">Autopilot</span>
            <IconButton size="sm" title="Close" onClick={() => setOpen(false)}>
              <X size={12} />
            </IconButton>
          </div>
          <p className="mb-2 text-[11.5px] leading-4 text-muted">
            Answers Ask Claude and every storyboard step in the background with your Claude plan. Waiting costs nothing; each request is
            one Claude Code run.
          </p>
          <div className="mb-2 space-y-0.5 text-[11.5px]">
            <div className="flex items-center gap-1.5">
              <span className={cx("h-1.5 w-1.5 rounded-full", DOTS[state])} />
              <span>{LABELS[state]}</span>
            </div>
            {autopilot.message && <div className="select-text break-words text-muted">{autopilot.message}</div>}
            {autopilot.model && (
              <div className="font-mono text-[10.5px] text-muted">
                {autopilot.model}
                {autopilot.effort && ` · effort ${autopilot.effort.deep ?? "default"} for storyboards and builds, ${autopilot.effort.normal ?? "default"} for edits`}
              </div>
            )}
            {chatListening && !running && <div className="text-accent-2">A Claude chat is listening to the editor right now and answers your requests.</div>}
          </div>
          <div className="mb-2 flex items-center gap-1.5">
            {running ? (
              <Button
                size="sm"
                variant="danger"
                icon={<PowerOff size={13} />}
                loading={busy === "stop"}
                onClick={() => void run("stop")}
                title={state === "working" ? "Stops the request it is working on too" : "Stop the autopilot"}
              >
                {state === "working" ? "Stop (cancels the current request)" : "Stop"}
              </Button>
            ) : (
              <Button size="sm" variant="primary" icon={<Power size={13} />} loading={busy === "start"} onClick={() => void run("start")}>
                Start
              </Button>
            )}
            {state === "signed-out" && (
              <Button size="sm" icon={<LogIn size={13} />} loading={busy === "sign-in"} onClick={() => void run("sign-in")} title="Opens a window that signs Claude Code in">
                Sign in to Claude
              </Button>
            )}
          </div>
          <pre className="ms-scroll max-h-56 select-text overflow-auto whitespace-pre-wrap rounded border border-border bg-panel p-2 font-mono text-[10.5px] leading-4 text-muted">
            {log.length ? log.join("\n") : "No log yet."}
          </pre>
        </div>
      )}
    </div>
  );
}

"use client";
/**
 * The editor's quality check (docs/QUALITY.md): renders the open project
 * headlessly on this computer and lists what to fix. Clicking an issue jumps to
 * its time and selects its layer; "Ask Claude to fix" queues one whole-scene
 * request with the list, through the same queue as the Ask Claude tab.
 */
import { CircleAlert, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import type { AiEditRequest } from "@/lib/types";
import { useBridgeStore } from "@/store/bridgeStore";
import { chatKeyFor, errorMessage, useEditorStore } from "@/store/editorStore";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";

interface Issue {
  severity: "error" | "warning";
  kind: string;
  message: string;
  layerId: string | null;
  start: number;
  end: number;
}

interface Report {
  duration: number;
  frames: number;
  issues: Issue[];
}

export function QualityDialog({ onClose }: { onClose: () => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const project = useEditorStore.getState().project;
    if (!project) return;
    let cancelled = false;
    void fetch("/api/qa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project }) })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { report?: Report; text?: string; error?: string } | null;
        if (cancelled) return;
        if (!response.ok || !body?.report) setError(body?.error ?? `The check failed (HTTP ${response.status})`);
        else {
          setReport(body.report);
          setText(body.text ?? "");
        }
      })
      .catch((failure: unknown) => !cancelled && setError(errorMessage(failure)));
    return () => {
      cancelled = true;
    };
  }, []);

  const jump = (issue: Issue) => {
    const store = useEditorStore.getState();
    store.pause();
    store.seek(issue.start + Math.min(0.1, (issue.end - issue.start) / 2));
    if (issue.layerId && store.scene?.byId[issue.layerId]) store.select(issue.layerId);
    onClose();
  };

  const askClaude = async () => {
    const store = useEditorStore.getState();
    if (!store.project || !text || useBridgeStore.getState().pending) return;
    const prompt = `Fix these problems found by the quality check. Keep everything else as it is.\n\n${text}`;
    const request: AiEditRequest = { scope: "scene", prompt, project: store.project };
    try {
      const response = await fetch("/api/bridge/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const body = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!response.ok || !body?.id) throw new Error(body?.error ?? `HTTP ${response.status}`);
      const key = chatKeyFor("scene", null);
      store.appendChat(key, { role: "user", content: prompt });
      useBridgeStore.getState().setPending({ id: body.id, scope: "scene", layerId: null, key, prompt, sentAt: Date.now() });
      setSent(true);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const errors = report?.issues.filter((issue) => issue.severity === "error").length ?? 0;
  return (
    <Modal
      title="Quality check"
      onClose={onClose}
      width={560}
      footer={
        report && report.issues.length > 0 ? (
          <>
            <span className="mr-auto text-[11px] text-muted">{sent ? "Sent to Claude: see the Ask Claude tab." : `${report.frames} frames checked`}</span>
            <Button variant="primary" icon={<Sparkles size={13} />} disabled={sent} onClick={() => void askClaude()}>
              Ask Claude to fix
            </Button>
          </>
        ) : undefined
      }
    >
      {!report && !error && (
        <p className="flex items-center gap-2 text-[12px] text-muted">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> Rendering the video on this computer and checking it… (a few seconds to a minute)
        </p>
      )}
      {error && <p className="text-[12px] text-danger">{error}</p>}
      {report && report.issues.length === 0 && (
        <p className="flex items-center gap-2 text-[12.5px] text-success">
          <ShieldCheck size={16} /> No problems found in {report.frames} frames.
        </p>
      )}
      {report && report.issues.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="mb-1 text-[12px] text-muted">
            {errors ? `${errors} problem(s) to fix, ` : ""}
            {report.issues.length - errors} suggestion(s). Click one to jump there.
          </p>
          {report.issues.map((issue, index) => (
            <button
              key={index}
              type="button"
              onClick={() => jump(issue)}
              className="ms-focus flex items-start gap-2 rounded border border-border bg-panel px-2.5 py-2 text-left hover:bg-panel-3"
            >
              {issue.severity === "error" ? (
                <CircleAlert size={14} className="mt-0.5 shrink-0 text-danger" />
              ) : (
                <TriangleAlert size={14} className="mt-0.5 shrink-0 text-accent-2" />
              )}
              <span dir="auto" className="flex-1 text-[12px] leading-[1.5]">
                {issue.message}
              </span>
              <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted">
                {issue.start.toFixed(1)}–{issue.end.toFixed(1)}s
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

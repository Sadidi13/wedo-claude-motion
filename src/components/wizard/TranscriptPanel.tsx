"use client";
/**
 * What is said in a footage or voice file (Whisper, run on this computer by the server), with each
 * segment editable: a misheard brand name is fixed here once, and every step after uses the fix.
 */
import { LoaderCircle, Mic, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { getTranscript, saveTranscript, startTranscript, type TranscriptView } from "@/lib/mediaClient";
import { Button } from "../ui/Button";

const POLL_MS = 3_000;

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

/** `known`: the transcript state the caller last saw (the wizard starts Whisper itself), so this panel reloads when it changes. */
export function TranscriptPanel({ mediaId, language, known }: { mediaId: string; language?: string; known?: string }) {
  const [view, setView] = useState<TranscriptView | null>(null);
  const [texts, setTexts] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const state = view?.status?.state ?? null;

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const next = await getTranscript(mediaId);
        if (disposed) return;
        setView(next);
        if (next.transcript) setTexts((current) => current ?? next.transcript!.segments.map((s) => s.text));
        if (next.status?.state === "processing") timer = setTimeout(() => void load(), POLL_MS);
      } catch (error) {
        if (!disposed) setProblem(error instanceof Error ? error.message : String(error));
      }
    };
    void load();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [mediaId, state, known]);

  const start = async () => {
    setProblem(null);
    try {
      await startTranscript(mediaId, language);
      setView(await getTranscript(mediaId));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };

  const save = async () => {
    if (!texts) return;
    setSaving(true);
    setProblem(null);
    try {
      await saveTranscript(mediaId, texts);
      const next = await getTranscript(mediaId);
      setView(next);
      setTexts(next.transcript?.segments.map((s) => s.text) ?? texts);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  if (!view) return <p className="text-[11px] text-muted">Checking the transcript…</p>;
  if (!view.canTranscribe) return null;

  const segments = view.transcript?.segments ?? [];
  const changed = texts !== null && segments.some((segment, i) => texts[i] !== segment.text);

  return (
    <div className="mt-2 rounded border border-border bg-panel p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
          <Mic size={12} /> What is said
        </span>
        {state === "ready" && (
          <Button size="sm" icon={<Save size={12} />} disabled={!changed} loading={saving} onClick={() => void save()}>
            Save corrections
          </Button>
        )}
      </div>
      {state === null &&
        (view.available ? (
          <Button size="sm" onClick={() => void start()} title="Whisper writes down what is said, on this computer (no Claude usage)">
            Transcribe
          </Button>
        ) : (
          <p className="text-[11px] text-muted">Whisper is not set up on this computer. Type what is said in the script box instead.</p>
        ))}
      {state === "processing" && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted">
          <LoaderCircle size={12} className="animate-spin" /> Whisper is listening… this takes a few minutes, keep going with the other steps.
        </p>
      )}
      {state === "error" && (
        <div className="flex flex-col items-start gap-1.5">
          <p className="text-[11px] text-danger">{view.status?.error ?? "Transcribing failed"}</p>
          {view.available && (
            <Button size="sm" onClick={() => void start()}>
              Try again
            </Button>
          )}
        </div>
      )}
      {state === "ready" && texts && (
        <div className="ms-scroll flex max-h-64 flex-col gap-1 overflow-auto pr-1">
          {segments.length === 0 && <p className="text-[11px] text-muted">No speech was found.</p>}
          {segments.map((segment, i) => (
            <label key={i} className="flex items-start gap-2">
              <span className="w-[86px] shrink-0 pt-1 font-mono text-[10.5px] tabular-nums text-muted">
                {clock(segment.start)}–{clock(segment.end)}
              </span>
              <input
                dir="auto"
                className="ms-input h-7 min-w-0 flex-1 select-text text-[12px]"
                value={texts[i] ?? ""}
                onChange={(event) => setTexts(texts.map((text, j) => (j === i ? event.target.value : text)))}
                aria-label={`Segment at ${clock(segment.start)}`}
              />
            </label>
          ))}
        </div>
      )}
      {problem && <p className="mt-1 text-[11px] text-danger">{problem}</p>}
    </div>
  );
}

"use client";
/**
 * Code tab: a monospace textarea with the exact JSX of the selected layer
 * (or, with "Whole scene" on, the full entry file). Tab inserts two spaces.
 * Apply runs `replaceLayer` / `setSource` and shows the parser's error inline
 * when the text does not parse; Revert restores the current source.
 */
import { Check, RotateCcw } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { getLayerSource } from "@/lib/parser";
import { entrySource, errorMessage, useEditorStore } from "@/store/editorStore";
import { Button } from "./ui/Button";
import { Checkbox } from "./ui/Checkbox";

interface CodeEditorProps {
  original: string;
  readOnly?: boolean;
  onApply: (text: string) => void;
}

function CodeEditor({ original, readOnly, onApply }: CodeEditorProps) {
  const [draft, setDraft] = useState(original);
  const [error, setError] = useState<string | null>(null);
  const dirty = draft !== original;

  const apply = () => {
    try {
      onApply(draft);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const el = event.currentTarget;
      el.setRangeText("  ", el.selectionStart, el.selectionEnd, "end");
      setDraft(el.value);
    } else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if (dirty) apply();
    }
  };

  return (
    <>
      <textarea
        className="ms-scroll ms-focus min-h-0 flex-1 select-text resize-none bg-[#0f1116] px-3 py-2 font-mono text-[12px] leading-5 text-foreground outline-none"
        value={draft}
        readOnly={readOnly}
        spellCheck={false}
        wrap="off"
        aria-label="Layer source"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {error && (
        <pre className="ms-scroll max-h-28 shrink-0 select-text overflow-auto whitespace-pre-wrap border-t border-danger/40 bg-danger/10 px-3 py-2 font-mono text-[11px] leading-4 text-danger">
          {error}
        </pre>
      )}
      <div className="flex shrink-0 items-center gap-1.5 border-t border-border px-2 py-1.5">
        <Button size="sm" variant="primary" icon={<Check size={13} />} disabled={!dirty || readOnly} onClick={apply} title="Apply (Ctrl+Enter)">
          Apply
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<RotateCcw size={13} />}
          disabled={!dirty}
          onClick={() => {
            setDraft(original);
            setError(null);
          }}
        >
          Revert
        </Button>
        <span className="ml-auto text-[11px] text-muted">{dirty ? "Unsaved changes" : "Up to date"}</span>
      </div>
    </>
  );
}

export function CodeTab() {
  const { selectedId, selectedName, hasScene, source, entry, revision, hasProject } = useEditorStore(
    useShallow((s) => ({
      selectedId: s.selectedId,
      selectedName: s.selectedId ? (s.scene?.byId[s.selectedId]?.name ?? null) : null,
      hasScene: s.scene !== null,
      source: s.project ? entrySource(s.project) : "",
      entry: s.project?.entry ?? "scene.jsx",
      revision: s.filesRevision,
      hasProject: s.project !== null,
    })),
  );
  const [wholeScene, setWholeScene] = useState(false);
  const sceneMode = wholeScene || !selectedId || !hasScene;

  const original = useMemo(() => {
    if (sceneMode) return source;
    try {
      return getLayerSource(source, selectedId ?? "");
    } catch {
      return "";
    }
  }, [sceneMode, source, selectedId]);

  if (!hasProject) return <p className="px-3 py-3 text-muted">Loading project…</p>;

  const store = useEditorStore.getState();
  const apply = (text: string) => {
    if (sceneMode) store.setSource(text);
    else if (selectedId) store.replaceLayer(selectedId, text);
  };

  return (
    <>
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted" title={sceneMode ? entry : selectedId ?? ""}>
          {sceneMode ? entry : `${selectedName ?? selectedId} · ${selectedId}`}
        </span>
        <Checkbox label="Whole scene" checked={wholeScene} onChange={setWholeScene} disabled={!selectedId || !hasScene} />
      </div>
      <CodeEditor key={`${sceneMode ? "scene" : selectedId}:${revision}`} original={original} onApply={apply} />
    </>
  );
}

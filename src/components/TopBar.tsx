"use client";
/**
 * Top bar: product mark, editable project name, Import / Export / Save
 * (project .zip), Undo / Redo, stage readout, the preview-error pill (click
 * to expand the message + stack) and transient notices from the store.
 */
import { Download, Film, FolderOpen, Redo2, Save, TriangleAlert, Undo2, X } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { DISCLAIMER, PRODUCT_NAME } from "@/lib/brand";
import { exportProjectZip } from "@/lib/importer";
import { errorMessage, useEditorStore } from "@/store/editorStore";
import { Button } from "./ui/Button";
import { cx } from "./ui/cx";
import { downloadBlob } from "./ui/download";
import { IconButton } from "./ui/IconButton";

interface TopBarProps {
  onImport: () => void;
  onExport: () => void;
}

const NOTICE_TTL_MS = 5000;

function ProjectName({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== name) onRename(draft);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") commit();
    if (event.key === "Escape") {
      setDraft(name);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        autoFocus
        className="ms-input h-7 w-56 select-text font-medium"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        aria-label="Project name"
      />
    );
  }
  return (
    <button
      type="button"
      title="Rename project"
      onClick={() => {
        setDraft(name);
        setEditing(true);
      }}
      className="ms-focus h-7 max-w-64 truncate rounded px-2 text-[13px] font-medium hover:bg-panel-3"
    >
      {name}
    </button>
  );
}

export function TopBar({ onImport, onExport }: TopBarProps) {
  const { project, meta, canUndo, canRedo, previewError, previewErrorDetail, notice, parseError } = useEditorStore(
    useShallow((s) => ({
      project: s.project,
      meta: s.scene?.meta ?? s.project?.meta ?? null,
      canUndo: s.history.past.length > 0,
      canRedo: s.history.future.length > 0,
      previewError: s.previewError,
      previewErrorDetail: s.previewErrorDetail,
      notice: s.notice,
      parseError: s.parseError,
    })),
  );
  const { undo, redo, setProjectName, setNotice } = useEditorStore.getState();
  const [showError, setShowError] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_TTL_MS);
    return () => clearTimeout(timer);
  }, [notice, setNotice]);

  const saveZip = async () => {
    if (!project) return;
    setSaving(true);
    try {
      const blob = await exportProjectZip(project);
      downloadBlob(blob, `${project.name.replace(/[\\/:*?"<>|]+/g, "-") || "project"}.zip`);
    } catch (error) {
      setNotice({ kind: "error", message: `Save failed: ${errorMessage(error)}` });
    } finally {
      setSaving(false);
    }
  };

  const errorText = parseError ? `Scene does not parse: ${parseError}` : previewError;

  return (
    <header className="relative flex h-full items-center gap-2 border-b border-border bg-panel px-3">
      <div className="flex items-center gap-2 pr-2 text-accent" title={DISCLAIMER}>
        <Film size={16} />
        <span className="whitespace-nowrap text-[13px] font-semibold tracking-tight text-foreground">{PRODUCT_NAME}</span>
      </div>
      <div className="h-5 w-px bg-border" />
      {project ? <ProjectName name={project.name} onRename={setProjectName} /> : <span className="text-muted">Loading…</span>}

      <div className="ml-2 flex items-center gap-1">
        <Button size="sm" icon={<FolderOpen size={14} />} onClick={onImport} title="Import a Claude Design zip, HTML or JSX scene">
          Import
        </Button>
        <Button size="sm" icon={<Download size={14} />} onClick={onExport} disabled={!project} title="Render a video">
          Export
        </Button>
        <Button size="sm" icon={<Save size={14} />} onClick={saveZip} disabled={!project} loading={saving} title="Save the project as a .zip">
          Save
        </Button>
      </div>

      <div className="ml-1 flex items-center">
        <IconButton title="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
          <Undo2 size={16} />
        </IconButton>
        <IconButton title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo}>
          <Redo2 size={16} />
        </IconButton>
      </div>

      <div className="min-w-0 flex-1" />

      {notice && (
        <div
          role="status"
          className={cx(
            "flex max-w-[40vw] items-center gap-2 truncate rounded border px-2 py-1 text-[11.5px]",
            notice.kind === "error" && "border-danger/40 bg-danger/10 text-danger",
            notice.kind === "warning" && "border-accent-2/40 bg-accent-2/10 text-accent-2",
            notice.kind === "info" && "border-border bg-panel-2 text-foreground",
          )}
        >
          <span className="truncate" title={notice.message}>
            {notice.message}
          </span>
          <IconButton size="sm" title="Dismiss" onClick={() => setNotice(null)}>
            <X size={12} />
          </IconButton>
        </div>
      )}

      {errorText && (
        <button
          type="button"
          onClick={() => setShowError((v) => !v)}
          title="Show the preview error"
          className="ms-focus flex items-center gap-1.5 rounded border border-danger/40 bg-danger/10 px-2 py-1 text-[11.5px] text-danger hover:bg-danger/20"
        >
          <TriangleAlert size={14} />
          {parseError ? "Parse error" : "Preview error"}
        </button>
      )}

      {meta && (
        <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums text-muted" title="Stage size · duration · frame rate">
          <span>
            {meta.width}×{meta.height}
          </span>
          <span>·</span>
          <span>{meta.duration}s</span>
          <span>·</span>
          <span>{meta.fps} fps</span>
        </div>
      )}

      {showError && errorText && (
        <div className="absolute right-3 top-full z-40 mt-1 w-[520px] max-w-[80vw] rounded-md border border-danger/40 bg-panel-2 p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-semibold text-danger">{parseError ? "The scene file does not parse" : "The preview could not render"}</span>
            <IconButton size="sm" title="Close" onClick={() => setShowError(false)}>
              <X size={12} />
            </IconButton>
          </div>
          <pre className="ms-scroll max-h-64 select-text overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-4 text-foreground">
            {errorText}
            {previewErrorDetail && !parseError ? `\n\n${previewErrorDetail}` : ""}
          </pre>
        </div>
      )}
    </header>
  );
}

"use client";
/**
 * Version history of the open project (docs/VERSIONS.md): the versions saved
 * when it was opened, after every change Claude made, and by hand. Restoring
 * saves the current state first and is one undoable edit.
 */
import { History, RotateCcw, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { errorMessage, useEditorStore } from "@/store/editorStore";
import { type ProjectVersion, listVersions, saveVersion } from "@/store/versions";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";

function when(at: number): string {
  const date = new Date(at);
  const today = new Date().toDateString() === date.toDateString();
  return today ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : date.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

export function HistoryDialog({ onClose }: { onClose: () => void }) {
  const projectId = useEditorStore((s) => s.project?.id ?? null);
  const [versions, setVersions] = useState<ProjectVersion[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (projectId) setVersions(await listVersions(projectId));
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    if (projectId) void listVersions(projectId).then((list) => !cancelled && setVersions(list));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const saveNow = async () => {
    const project = useEditorStore.getState().project;
    if (!project) return;
    const saved = await saveVersion(project, "Saved by hand");
    setMessage(saved ? "Saved." : "Nothing changed since the last version.");
    await reload();
  };

  const restore = async (version: ProjectVersion) => {
    const store = useEditorStore.getState();
    const project = store.project;
    const entry = version.files[version.entry]?.content;
    if (!project || entry === undefined) return;
    try {
      await saveVersion(project, `Before restoring “${version.label}”`);
      for (const [path, file] of Object.entries(version.files)) {
        if (path !== project.entry && project.files[path]?.content !== file.content) store.updateFile(path, file.content);
      }
      store.setSource(entry);
      store.setNotice({ kind: "info", message: `Restored “${version.label}” (Undo reverts it)` });
      onClose();
    } catch (error) {
      setMessage(`Could not restore: ${errorMessage(error)}`);
    }
  };

  return (
    <Modal
      title="Version history"
      onClose={onClose}
      width={520}
      footer={
        <>
          <span className="mr-auto text-[11px] text-muted">{message ?? "Kept in this browser, up to 60 per project."}</span>
          <Button icon={<Save size={13} />} onClick={() => void saveNow()}>
            Save a version now
          </Button>
        </>
      }
    >
      {!versions && <p className="text-[12px] text-muted">Loading…</p>}
      {versions && versions.length === 0 && <p className="text-[12px] text-muted">No versions yet. They are saved when Claude changes the project, or with the button below.</p>}
      {versions && versions.length > 0 && (
        <ul className="flex flex-col gap-1">
          {versions.map((version, index) => (
            <li key={version.id} className="flex items-center gap-2 rounded border border-border bg-panel px-2.5 py-1.5">
              <History size={13} className="shrink-0 text-muted" />
              <span dir="auto" className="min-w-0 flex-1 truncate text-[12px]" title={version.label}>
                {version.label}
              </span>
              <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted">{when(version.at)}</span>
              <Button size="sm" variant="ghost" icon={<RotateCcw size={12} />} disabled={index === 0} onClick={() => void restore(version)} title={index === 0 ? "This is the latest version" : "Restore this version"}>
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

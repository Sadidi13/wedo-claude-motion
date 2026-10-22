"use client";
/**
 * Import dialog: drop zone / file input for Claude Design project archives
 * (.zip), standalone HTML exports (.html) and raw scene files (.jsx/.js), the
 * bundled sample picker and a "Blank project" starter. Everything goes
 * through the importer (CONTRACTS §7) and then `loadProject`.
 */
import { FilePlus, Upload } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { importFromHtml, importFromJsx, importFromZip } from "@/lib/importer";
import type { Project } from "@/lib/types";
import { samples } from "@/samples";
import { errorMessage, useEditorStore } from "@/store/editorStore";
import { instantiateProject } from "./hooks/useBootstrap";
import { Button } from "./ui/Button";
import { cx } from "./ui/cx";
import { Modal } from "./ui/Modal";

const ACCEPT = ".zip,.html,.htm,.jsx,.js";

async function importFile(file: File): Promise<Project> {
  const ext = file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase();
  const name = file.name.replace(/\.[^.]+$/, "") || "Imported project";
  if (ext === "zip") return importFromZip(await file.arrayBuffer(), { name });
  const text = await file.text();
  if (ext === "html" || ext === "htm" || /^\s*<(!doctype|html)/i.test(text)) return importFromHtml(text, { name });
  return importFromJsx(text, { name });
}

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = (project: Project) => {
    useEditorStore.getState().loadProject(project);
    onClose();
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      load(await importFile(file));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    void handleFile(event.dataTransfer.files[0]);
  };

  return (
    <Modal title="Import project" onClose={onClose} width={560}>
      <div className="flex flex-col gap-4">
        <div
          role="button"
          tabIndex={0}
          aria-label="Drop a .zip, .html or .jsx file here"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cx(
            "ms-focus flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-8 text-center transition-colors",
            dragOver ? "border-accent bg-accent/10" : "border-border-strong hover:border-accent/60 hover:bg-panel-3/50",
          )}
        >
          <Upload size={20} className="text-accent" />
          <p className="text-[12.5px]">Drop a file here or click to browse</p>
          <p className="text-[11px] text-muted">Claude Design project archive (.zip) · standalone HTML export (.html) · scene file (.jsx / .js)</p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            aria-label="Project file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void handleFile(file);
            }}
          />
        </div>
        {busy && <p className="text-[11.5px] text-muted">Importing…</p>}
        {error && <pre className="select-text whitespace-pre-wrap rounded border border-danger/40 bg-danger/10 px-2 py-1.5 font-mono text-[11px] text-danger">{error}</pre>}

        <div>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Samples</h3>
          <div className="flex flex-col gap-1">
            {samples.map((sample) => (
              <button
                key={sample.id}
                type="button"
                onClick={() => load(instantiateProject(sample.project, "sample"))}
                className="ms-focus flex flex-col items-start rounded border border-border bg-panel px-3 py-2 text-left hover:border-accent/60 hover:bg-panel-3/60"
              >
                <span className="text-[12.5px] font-medium">{sample.name}</span>
                <span className="text-[11px] text-muted">{sample.description}</span>
                <span className="mt-0.5 font-mono text-[10px] text-muted">
                  {sample.project.meta.width}×{sample.project.meta.height} · {sample.project.meta.duration}s · {sample.project.meta.fps} fps
                </span>
              </button>
            ))}
            {samples.length === 0 && <p className="text-[11px] text-muted">No bundled samples.</p>}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="text-[11px] text-muted">Start from scratch (1280×720, 8s, 30fps).</span>
          <Button
            icon={<FilePlus size={14} />}
            onClick={() => {
              useEditorStore.getState().newBlankProject({ width: 1280, height: 720, duration: 8, fps: 30 });
              onClose();
            }}
          >
            Blank project
          </Button>
        </div>
      </div>
    </Modal>
  );
}

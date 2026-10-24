"use client";
/**
 * Export dialog: format (mp4 / webm / mov / gif / png-sequence), transparency
 * (alpha-capable formats only), fps, 1×/2× scale, in/out range and quality;
 * starts the job through POST /api/export, polls its status, shows a progress
 * bar with frame counts and the download link when done (errors verbatim).
 */
import { Download, Play } from "lucide-react";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { ExportFormat, ExportOptions } from "@/lib/types";
import { useEditorStore } from "@/store/editorStore";
import { useExportJob } from "./hooks/useExportJob";
import { Button } from "./ui/Button";
import { Checkbox } from "./ui/Checkbox";
import { Field } from "./ui/Field";
import { Modal } from "./ui/Modal";
import { NumberField } from "./ui/NumberField";
import { Segmented } from "./ui/Segmented";

const FORMATS: { value: ExportFormat; label: string; alpha: boolean }[] = [
  { value: "mp4", label: "MP4 (H.264)", alpha: false },
  { value: "webm", label: "WebM (VP9, alpha)", alpha: true },
  { value: "mov", label: "MOV (ProRes 4444, alpha)", alpha: true },
  { value: "gif", label: "GIF", alpha: false },
  { value: "png-sequence", label: "PNG sequence (.zip)", alpha: true },
];

const STATE_LABEL: Record<string, string> = {
  queued: "Queued",
  rendering: "Rendering frames",
  encoding: "Encoding",
  done: "Done",
  error: "Failed",
};

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const { project, meta, soundLayers } = useEditorStore(
    useShallow((s) => ({
      project: s.project,
      meta: s.scene?.meta ?? s.project?.meta ?? null,
      soundLayers: s.scene ? Object.values(s.scene.byId).filter((node) => node.kind === "audio" && !node.hidden).length : 0,
    })),
  );
  const job = useExportJob();

  const [format, setFormat] = useState<ExportFormat>("mp4");
  const [transparent, setTransparent] = useState(false);
  const [fps, setFps] = useState(meta?.fps ?? 30);
  const [scale, setScale] = useState<"1" | "2">("1");
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(meta?.duration ?? 0);
  const [quality, setQuality] = useState(17);
  const [sound, setSound] = useState(true);

  if (!project || !meta) {
    return (
      <Modal title="Export" onClose={onClose}>
        <p className="text-muted">No project loaded.</p>
      </Modal>
    );
  }

  const alphaCapable = FORMATS.find((f) => f.value === format)?.alpha ?? false;
  const running = job.starting || (job.status !== null && job.status.state !== "done" && job.status.state !== "error");
  const frames = Math.max(0, Math.round((rangeEnd - rangeStart) * fps));
  const outWidth = meta.width * Number(scale);
  const outHeight = meta.height * Number(scale);

  const start = () => {
    const options: ExportOptions = {
      format,
      fps,
      scale: scale === "2" ? 2 : 1,
      range: { start: rangeStart, end: rangeEnd },
      transparent: alphaCapable && transparent,
      quality,
      audio: sound,
    };
    void job.start({ project, options });
  };

  const status = job.status;
  const progress = status ? Math.round(status.progress * 100) : 0;

  return (
    <Modal
      title="Export video"
      onClose={onClose}
      width={520}
      footer={
        <>
          <span className="mr-auto font-mono text-[11px] text-muted">
            {outWidth}×{outHeight} · {frames} frames · {fps} fps
          </span>
          <Button variant="ghost" onClick={onClose}>
            {status?.state === "done" ? "Close" : "Cancel"}
          </Button>
          <Button variant="primary" icon={<Play size={14} />} onClick={start} loading={running} disabled={rangeEnd <= rangeStart}>
            {status ? "Render again" : "Start export"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Format">
          <select className="ms-input ms-focus w-full" value={format} onChange={(event) => setFormat(event.target.value as ExportFormat)} aria-label="Format">
            {FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>
        <Checkbox
          label="Transparent background (alpha)"
          checked={alphaCapable && transparent}
          disabled={!alphaCapable}
          onChange={setTransparent}
          title={alphaCapable ? "Export with an alpha channel" : "Only WebM, MOV and PNG sequences keep alpha"}
        />
        {soundLayers > 0 && (
          <Checkbox
            label={`Include sound (${soundLayers} audio layer${soundLayers === 1 ? "" : "s"})`}
            checked={format !== "gif" && sound}
            disabled={format === "gif"}
            onChange={setSound}
            title={format === "gif" ? "GIF has no sound" : format === "png-sequence" ? "Adds audio.wav to the zip" : "Mixes the audio layers into the video"}
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Frame rate">
            <NumberField value={fps} min={1} max={120} step={1} decimals={0} suffix="fps" onCommit={setFps} />
          </Field>
          <Field label="Scale">
            <Segmented
              block
              size="sm"
              value={scale}
              onChange={setScale}
              options={[
                { value: "1", label: "1×", title: `${meta.width}×${meta.height}` },
                { value: "2", label: "2×", title: `${meta.width * 2}×${meta.height * 2}` },
              ]}
            />
          </Field>
          <Field label="In point">
            <NumberField value={rangeStart} min={0} max={Math.max(0, rangeEnd - 1 / fps)} step={1 / fps} suffix="s" onCommit={setRangeStart} />
          </Field>
          <Field label="Out point">
            <NumberField value={rangeEnd} min={rangeStart + 1 / fps} max={meta.duration} step={1 / fps} suffix="s" onCommit={setRangeEnd} />
          </Field>
          <Field label="Quality (CRF)" hint="Lower is better: 17 is visually lossless, 23 is the x264 default.">
            <NumberField value={quality} min={0} max={51} step={1} decimals={0} onCommit={setQuality} />
          </Field>
        </div>

        {(status || job.error) && (
          <div className="flex flex-col gap-2 rounded border border-border bg-panel p-3">
            <div className="flex items-center justify-between text-[11.5px]">
              <span className={status?.state === "error" || job.error ? "text-danger" : "text-foreground"}>
                {job.error ? "Request failed" : STATE_LABEL[status?.state ?? "queued"]}
              </span>
              {status && status.framesTotal > 0 && (
                <span className="font-mono text-muted">
                  {status.framesDone}/{status.framesTotal} frames · {progress}%
                </span>
              )}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded bg-panel-3">
              <div className={status?.state === "error" ? "h-full bg-danger" : "h-full bg-accent transition-[width]"} style={{ width: `${status?.state === "done" ? 100 : progress}%` }} />
            </div>
            {(job.error || status?.error) && (
              <pre className="select-text whitespace-pre-wrap font-mono text-[11px] text-danger">{job.error ?? status?.error}</pre>
            )}
            {status?.state === "done" && status.downloadUrl && (
              <a
                href={status.downloadUrl}
                download={status.fileName}
                className="ms-focus inline-flex h-7 w-fit items-center gap-1.5 rounded bg-success px-2.5 text-[12px] font-semibold text-[#0b0d14] hover:brightness-110"
              >
                <Download size={14} /> Download {status.fileName ?? "file"}
              </a>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

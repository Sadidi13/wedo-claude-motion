"use client";
/**
 * Motion Studio editor shell: a full-viewport CSS grid with the top bar,
 * Layers panel (left), Canvas (centre), Inspector (right) and the
 * user-resizable Timeline (bottom). Owns only layout state (timeline height,
 * active inspector tab, open dialog); everything else lives in the store.
 */
import { useCallback, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Canvas } from "./Canvas";
import { ExportDialog } from "./ExportDialog";
import { useBootstrap } from "./hooks/useBootstrap";
import { useEditorHotkeys } from "./hooks/useEditorHotkeys";
import { ImportDialog } from "./ImportDialog";
import { Inspector, type InspectorTab } from "./Inspector";
import { LayersPanel } from "./LayersPanel";
import { Timeline } from "./Timeline";
import { TopBar } from "./TopBar";

const TOPBAR_HEIGHT = 44;
const LAYERS_WIDTH = 280;
const INSPECTOR_WIDTH = 320;
const TIMELINE_DEFAULT = 240;
const TIMELINE_MIN = 140;
const TIMELINE_MAX = 560;

type Dialog = "import" | "export" | null;

export default function Editor() {
  useBootstrap();
  useEditorHotkeys();

  const [timelineHeight, setTimelineHeight] = useState(TIMELINE_DEFAULT);
  const [tab, setTab] = useState<InspectorTab>("properties");
  const [dialog, setDialog] = useState<Dialog>(null);

  const closeDialog = useCallback(() => setDialog(null), []);
  const openCode = useCallback(() => setTab("code"), []);

  const onResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = timelineHeight;
    const onMove = (move: PointerEvent) => {
      const next = startHeight - (move.clientY - startY);
      setTimelineHeight(Math.min(TIMELINE_MAX, Math.max(TIMELINE_MIN, next)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "row-resize";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      className="h-dvh w-full select-none overflow-hidden bg-background text-[12.5px] text-foreground"
      style={{
        display: "grid",
        gridTemplateRows: `${TOPBAR_HEIGHT}px minmax(0, 1fr) ${timelineHeight}px`,
        gridTemplateColumns: `${LAYERS_WIDTH}px minmax(0, 1fr) ${INSPECTOR_WIDTH}px`,
      }}
    >
      <div className="col-span-3 min-w-0">
        <TopBar onImport={() => setDialog("import")} onExport={() => setDialog("export")} />
      </div>
      <LayersPanel />
      <Canvas />
      <Inspector tab={tab} onTabChange={setTab} onOpenCode={openCode} />
      <div className="relative col-span-3 min-h-0 border-t border-border bg-panel">
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize timeline"
          title="Drag to resize the timeline"
          onPointerDown={onResizeStart}
          className="absolute -top-1 left-0 right-0 z-20 h-2 cursor-row-resize hover:bg-accent/40"
        />
        <Timeline />
      </div>
      {dialog === "import" && <ImportDialog onClose={closeDialog} />}
      {dialog === "export" && <ExportDialog onClose={closeDialog} />}
    </div>
  );
}

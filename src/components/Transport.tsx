"use client";
/**
 * Timeline transport: to start · step back · play/pause · step forward · to
 * end · loop · sound on/off, the "mm:ss:ff" + seconds readout and the zoom slider.
 */
import { Pause, Play, Repeat, SkipBack, SkipForward, StepBack, StepForward, Volume2, VolumeX, ZoomIn, ZoomOut } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useEditorStore } from "@/store/editorStore";
import { formatTimecode } from "@/store/time";
import { IconButton } from "./ui/IconButton";

interface TransportProps {
  pxPerSecond: number;
  min: number;
  max: number;
  onZoom: (pxPerSecond: number) => void;
}

export function Transport({ pxPerSecond, min, max, onZoom }: TransportProps) {
  const { time, playing, loop, muted, duration, fps } = useEditorStore(
    useShallow((s) => ({
      time: s.time,
      playing: s.playing,
      loop: s.loop,
      muted: s.muted,
      duration: s.scene?.meta.duration ?? s.project?.meta.duration ?? 0,
      fps: s.scene?.meta.fps ?? s.project?.meta.fps ?? 30,
    })),
  );
  const store = useEditorStore.getState();

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-panel px-2">
      <IconButton title="Go to start (Home)" onClick={() => { store.pause(); store.seek(0); }}>
        <SkipBack size={16} />
      </IconButton>
      <IconButton title="Previous frame (←)" onClick={() => store.stepFrames(-1)}>
        <StepBack size={16} />
      </IconButton>
      <IconButton title={playing ? "Pause (Space)" : "Play (Space)"} active={playing} onClick={() => store.togglePlay()} disabled={duration <= 0}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </IconButton>
      <IconButton title="Next frame (→)" onClick={() => store.stepFrames(1)}>
        <StepForward size={16} />
      </IconButton>
      <IconButton title="Go to end (End)" onClick={() => { store.pause(); store.seek(duration); }}>
        <SkipForward size={16} />
      </IconButton>
      <IconButton title={loop ? "Looping: on" : "Looping: off"} active={loop} onClick={() => store.toggleLoop()}>
        <Repeat size={16} />
      </IconButton>
      <IconButton title={muted ? "Sound off in the preview (exports keep it)" : "Sound on"} active={muted} onClick={() => store.toggleMuted()}>
        {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
      </IconButton>

      <div className="mx-2 flex items-center gap-2 rounded bg-panel-2 px-2 py-0.5 font-mono text-[12px] tabular-nums">
        <span className="text-foreground">{formatTimecode(time, fps)}</span>
        <span className="text-muted">{time.toFixed(2)}s</span>
        <span className="text-muted">/ {duration}s</span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1" title="Zoom (Ctrl + wheel)">
        <ZoomOut size={14} className="text-muted" />
        <input
          type="range"
          className="ms-range ms-focus w-28"
          min={min}
          max={max}
          step={1}
          value={pxPerSecond}
          aria-label="Timeline zoom"
          onChange={(event) => onZoom(Number(event.target.value))}
        />
        <ZoomIn size={14} className="text-muted" />
      </div>
    </div>
  );
}

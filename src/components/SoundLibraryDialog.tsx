"use client";
/**
 * Sound library (layers panel → Sound → Sound library…): the real recorded sounds and music beds of
 * src/lib/audio/realSounds.ts by kind. ▶ previews one (from /api/audio/sound/<name>; the server
 * downloads it from Freesound the first time, so the first play can take a moment); Add puts an
 * effect on the timeline with its hit on the playhead, and a bed from the playhead to the end.
 */
import { LoaderCircle, Play, Plus, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  REAL_SOUNDS,
  REAL_SOUND_GROUPS,
  REAL_SOUND_LICENSE,
  type RealSound,
  type RealSoundName,
  realSoundLabel,
  realSoundUrl,
} from "@/lib/audio/realSounds";
import { useEditorStore } from "@/store/editorStore";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";
import { Modal } from "./ui/Modal";

type Preview = { name: RealSoundName; state: "loading" | "playing" | "error" } | null;

export function SoundLibraryDialog({ onClose }: { onClose: () => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [preview, setPreview] = useState<Preview>(null);

  useEffect(
    () => () => {
      const element = audioRef.current;
      if (!element) return;
      element.pause();
      element.removeAttribute("src");
      element.load();
    },
    [],
  );

  const toggle = (name: RealSoundName) => {
    const element = (audioRef.current ??= new window.Audio());
    element.pause();
    if (preview?.name === name && preview.state !== "error") {
      setPreview(null);
      return;
    }
    const settle = (next: Preview) => setPreview((current) => (current?.name === name ? next : current));
    setPreview({ name, state: "loading" });
    element.onplaying = () => settle({ name, state: "playing" });
    element.onended = () => settle(null);
    element.onerror = () => settle({ name, state: "error" });
    element.src = realSoundUrl(name);
    void element.play().catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) settle({ name, state: "error" });
    });
  };

  const add = (name: RealSoundName) => {
    useEditorStore.getState().addRealSoundLayer(name);
    onClose();
  };

  return (
    <Modal
      title="Sound library"
      width={600}
      onClose={onClose}
      footer={
        <>
          <p className="mr-auto text-[11px] text-muted">Real recordings · {REAL_SOUND_LICENSE}</p>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <p className="mb-3 text-[12px] text-muted">
        Add puts an effect on the timeline so its hit lands on the playhead, and a music bed from the playhead to the end. Each sound
        downloads once, the first time it is played or added.
      </p>
      {REAL_SOUND_GROUPS.map((group) => (
        <section key={group.label} className="mb-3">
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{group.label}</h3>
          <ul className="divide-y divide-border rounded border border-border">
            {group.names.map((name) => {
              const sound: RealSound = REAL_SOUNDS[name];
              const state = preview?.name === name ? preview.state : null;
              return (
                <li key={name} className="flex items-center gap-2 px-2 py-1.5">
                  <IconButton title={state === "playing" || state === "loading" ? `Stop ${realSoundLabel(name)}` : `Play ${realSoundLabel(name)}`} onClick={() => toggle(name)}>
                    {state === "loading" ? (
                      <LoaderCircle size={14} className="animate-spin" />
                    ) : state === "playing" ? (
                      <Square size={12} />
                    ) : (
                      <Play size={14} />
                    )}
                  </IconButton>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 text-[12px]">
                      <span className="font-medium text-foreground">{realSoundLabel(name)}</span>
                      <span className="font-mono text-[10.5px] text-muted">
                        {sound.duration} s
                        {sound.music ? ` · ${sound.music.bpm} BPM${sound.music.loops ? " · loops" : ""}` : sound.peak >= 0.1 ? ` · hits at ${sound.peak} s` : ""}
                      </span>
                      {state === "loading" && <span className="text-[11px] text-muted">Getting it…</span>}
                      {state === "error" && <span className="text-[11px] text-danger">Could not download it (offline?)</span>}
                    </div>
                    <p className="truncate text-[11px] text-muted" title={`${sound.use} (“${sound.source.title}” by ${sound.source.author})`}>
                      {sound.use}
                    </p>
                  </div>
                  <Button size="sm" icon={<Plus size={13} />} onClick={() => add(name)}>
                    Add
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </Modal>
  );
}

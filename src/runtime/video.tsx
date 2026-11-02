"use client";
/**
 * <Video> — footage from the media library as a layer (docs/VIDEO.md). Put it in a <Sprite>,
 * which gives it its place on the timeline:
 *
 *   <Sprite start={0} end={12} data-layer-name="Footage">
 *     <Video src="media/k3f9x2abcd12.mp4" from={4} />
 *   </Sprite>
 *
 *   src     `media/<id>.<ext>`, from an import (editor: Layers → Video; Claude: `motion-bridge media`)
 *   from    seconds into the file at the Sprite's start (the file plays on from there)
 *   volume  0..1 for its sound (0 or `muted` leaves it out of the mix)
 *   fit     "cover" (default), "contain" or "fill" inside its box; the box fills its parent unless
 *           `style` places it
 *
 * The editor plays a light H.264 copy with a <video> element that follows the playhead (and its
 * sound, like <Audio>). Exports draw the frame for each stage time from the library's JPEG frames
 * instead, holding the frame (pending.ts) until the image is decoded, so every frame is exact; the
 * sound is reported with the <Audio> clips and mixed by ffmpeg from the original file.
 */

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties, type HTMLAttributes } from "react";
import { frameAt, mediaIdOf, mediaUrls, type MediaMeta } from "@/lib/media";
import { isEmbedded, isRenderMode, recordAudioClip, useAudioPlayback } from "./audio";
import { useClock, type ClockState } from "./clock";
import { clamp } from "./easing";
import { useSprite } from "./motion";
import { holdFrame } from "./pending";

export interface VideoProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  src: string;
  from?: number;
  volume?: number;
  muted?: boolean;
  fit?: "cover" | "contain" | "fill";
  [dataAttribute: `data-${string}`]: string | number | boolean | undefined;
}

// ---------------------------------------------------------------------------
// Media metadata, fetched once per id (polled while the server is still preparing the file)
// ---------------------------------------------------------------------------

interface MetaEntry {
  meta: MediaMeta | null;
  error: string | null;
}

const EMPTY: MetaEntry = { meta: null, error: null };
const POLL_MS = 1500;
const entries = new Map<string, MetaEntry>();
const loading = new Set<string>();
const listeners = new Set<() => void>();

function publish(id: string, entry: MetaEntry): void {
  entries.set(id, entry);
  for (const listener of listeners) listener();
}

function loadMeta(id: string): void {
  if (loading.has(id) || typeof fetch !== "function") return;
  loading.add(id);
  fetch(mediaUrls.meta(id), { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error(response.status === 404 ? "This video is not in the media library" : `HTTP ${response.status}`);
      return (await response.json()) as MediaMeta;
    })
    .then(
      (meta) => {
        publish(id, { meta, error: meta.state === "error" ? (meta.error ?? "The video could not be prepared") : null });
        if (meta.state === "processing") setTimeout(() => (loading.delete(id), loadMeta(id)), POLL_MS);
        else loading.delete(id);
      },
      (error: unknown) => {
        loading.delete(id);
        publish(id, { meta: null, error: error instanceof Error ? error.message : String(error) });
      },
    );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function useMediaMeta(id: string | null): MetaEntry {
  const entry = useSyncExternalStore(
    subscribe,
    () => (id ? (entries.get(id) ?? EMPTY) : EMPTY),
    () => EMPTY,
  );
  useEffect(() => {
    if (id && !entries.has(id)) loadMeta(id);
  }, [id]);
  return entry;
}

// ---------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------

const selectTime = (clock: ClockState) => clock.time;
const selectClockPlaying = (clock: ClockState) => clock.playing;
/** Re-seek while playing when the element drifts further than this from the playhead. */
const DRIFT_SECONDS = 0.2;

const PLACEHOLDER: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#111",
  color: "#9aa0aa",
  font: "500 14px/1.4 system-ui, sans-serif",
  textAlign: "center",
  padding: 12,
};

export function Video({ src, from = 0, volume = 1, muted = false, fit = "cover", style, ...rest }: VideoProps) {
  const id = mediaIdOf(src);
  const { meta, error } = useMediaMeta(id);
  const time = useClock(selectTime);
  const clockPlaying = useClock(selectClockPlaying);
  const { localTime, duration: spriteDuration } = useSprite();
  const { playing: editorPlaying, muted: editorMuted } = useAudioPlayback();
  const render = isRenderMode();
  const hidden = rest["data-hidden"] === true || rest["data-hidden"] === "true";
  const layerId = typeof rest["data-layer-id"] === "string" ? rest["data-layer-id"] : undefined;
  const ready = meta?.state === "ready";
  const sourceTime = Math.max(0, from + localTime);
  const frameUrl = id && ready && meta ? mediaUrls.frame(id, frameAt(meta, sourceTime)) : null;

  const imgRef = useRef<HTMLImageElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const holdRef = useRef<(() => void) | null>(null);

  // Export: hold the frame until the metadata is in and this frame's image is decoded. A new hold
  // is taken before the previous one is released, so the exporter never sees an idle gap.
  useLayoutEffect(() => {
    if (!render || hidden || !id) return;
    const next = holdFrame();
    const previous = holdRef.current;
    holdRef.current = next;
    previous?.();
    if (!frameUrl) {
      if (error) {
        holdRef.current = null;
        next();
      }
      return; // keep holding: the metadata (and then the image) is still on its way
    }
    const done = () => {
      if (holdRef.current === next) holdRef.current = null;
      next();
    };
    const image = imgRef.current;
    if (!image) done();
    else image.decode().then(done, done);
  }, [render, hidden, id, frameUrl, error]);

  useEffect(() => () => holdRef.current?.(), []);

  // The sound, for the export mix: from the original file, over the Sprite's window.
  useLayoutEffect(() => {
    if (hidden || !id || !meta?.hasAudio || muted || volume <= 0) return;
    const start = time - localTime;
    const length = Math.max(0, (meta.duration || Infinity) - from);
    const span = Number.isFinite(spriteDuration) ? Math.min(spriteDuration, length) : length;
    recordAudioClip({
      key: layerId ?? `video|${id}|${start}|${from}`,
      src: `media/${id}`,
      start,
      end: Number.isFinite(span) ? start + span : null,
      from,
      volume: clamp(volume, 0, 1),
      fadeIn: 0,
      fadeOut: 0,
      loop: false,
    });
  });

  // Editor / standalone: follow the playhead with the preview copy.
  useEffect(() => {
    const element = videoRef.current;
    if (render || !element || !ready) return;
    const playing = editorPlaying || (!isEmbedded() && clockPlaying);
    const expected = meta ? Math.min(sourceTime, Math.max(0, meta.duration - 0.001)) : sourceTime;
    element.volume = clamp(volume, 0, 1);
    element.muted = muted || editorMuted || volume <= 0;
    if (!playing) {
      if (!element.paused) element.pause();
      const frame = meta?.frameRate ? 0.5 / meta.frameRate : 0.02;
      if (Math.abs(element.currentTime - expected) > frame) element.currentTime = expected;
      return;
    }
    if (element.paused) {
      element.currentTime = expected;
      // Sound may be blocked until the first click in the page: play silently rather than not at all.
      void element.play().catch(() => {
        element.muted = true;
        return element.play().catch(() => undefined);
      });
    } else if (Math.abs(element.currentTime - expected) > DRIFT_SECONDS) {
      element.currentTime = expected;
    }
  }, [render, ready, time, sourceTime, editorPlaying, clockPlaying, muted, editorMuted, volume, meta]);

  const box: CSSProperties = { position: "absolute", inset: 0, overflow: "hidden", ...style };
  const media: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: fit, display: "block" };
  if (hidden) return <div {...rest} style={{ ...box, display: "none" }} />;

  let content;
  if (!id) content = <div style={PLACEHOLDER}>{`<Video> needs src="media/<id>.mp4" (got "${src}")`}</div>;
  else if (error) content = <div style={PLACEHOLDER}>{`Video ${src}: ${error}`}</div>;
  else if (!ready) content = <div style={PLACEHOLDER}>Preparing the video…</div>;
  // eslint-disable-next-line @next/next/no-img-element -- one exact export frame from the local library, nothing to optimise
  else if (render) content = <img ref={imgRef} src={frameUrl ?? undefined} alt="" draggable={false} style={media} />;
  else content = <video ref={videoRef} src={mediaUrls.preview(id)} preload="auto" playsInline muted style={media} />;

  return (
    <div data-video="" {...rest} style={box}>
      {content}
    </div>
  );
}

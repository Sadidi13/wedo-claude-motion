"use client";
/**
 * <Audio> — sound as a layer (docs/AUDIO.md). One element per clip, placed in
 * the Stage next to the Sprites:
 *
 *   <Audio src="assets/music.mp3" start={0} end={8} volume={0.8} fadeOut={1.5} data-layer-name="Music" />
 *   <Audio sfx="whoosh" start={1.2} data-layer-name="Whoosh" />
 *
 *   src / sfx   a project audio file (the loader turns the path into a data: URL)
 *               or a built-in sound (src/lib/audio/sfx.ts)
 *   start, end  stage seconds; without `end` the clip plays to its own length
 *               (or, looping, to the end of the stage)
 *   from        offset into the file, seconds
 *   volume      0..1; fadeIn / fadeOut in seconds; loop
 *
 * It draws nothing (a hidden marker element carries the data-* attributes so
 * it is a layer). Playback follows the editor: the preview tells the runtime
 * when the editor plays, pauses or mutes (`setAudioPlayback`), and each clip
 * seeks itself to the playhead, so scrubbing and looping stay in sync.
 * Standalone pages play with the Stage's own clock. In export (render mode)
 * nothing plays: every clip the page renders is recorded and
 * `window.__getAudioClips()` hands the list to the exporter, which mixes it
 * with ffmpeg.
 */

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type HTMLAttributes } from "react";
import { isSfxName, sfxDuration } from "@/lib/audio/sfx";
import { useClock, type ClockState } from "./clock";
import { clamp } from "./easing";
import { motionWindow } from "./globals";

/** One clip as the exporter sees it. `src` is a data: URL (or a URL); `sfx` a built-in sound. */
export interface AudioClip {
  key: string;
  src?: string;
  sfx?: string;
  start: number;
  /** null: to the clip's own end (or the stage end when looping) */
  end: number | null;
  from: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  loop: boolean;
}

export interface AudioProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  src?: string;
  sfx?: string;
  start?: number;
  end?: number;
  from?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  loop?: boolean;
  [dataAttribute: `data-${string}`]: string | number | boolean | undefined;
}

// ---------------------------------------------------------------------------
// Playback state (set by the preview page from the editor's transport)
// ---------------------------------------------------------------------------

interface PlaybackState {
  playing: boolean;
  muted: boolean;
}

let playback: PlaybackState = { playing: false, muted: false };
const playbackListeners = new Set<() => void>();

/** The editor started / stopped playback or toggled mute (called by the preview page). */
export function setAudioPlayback(next: Partial<PlaybackState>): void {
  const merged = { ...playback, ...next };
  if (merged.playing === playback.playing && merged.muted === playback.muted) return;
  playback = merged;
  for (const listener of playbackListeners) listener();
}

function subscribePlayback(listener: () => void): () => void {
  playbackListeners.add(listener);
  return () => {
    playbackListeners.delete(listener);
  };
}

const readPlayback = () => playback;

// ---------------------------------------------------------------------------
// Clips seen by this page (the exporter's list)
// ---------------------------------------------------------------------------

const seen = new Map<string, AudioClip>();

/** Forget the clips of the previous project (the loader calls it before mounting a new one). */
export function resetAudioClips(): void {
  seen.clear();
}

/** Every clip rendered since the last reset, once each (latest props win). */
export function audioClips(): AudioClip[] {
  return [...seen.values()];
}

function installGlobal(): void {
  const w = motionWindow() as (ReturnType<typeof motionWindow> & { __getAudioClips?: () => AudioClip[] }) | undefined;
  if (w && !w.__getAudioClips) w.__getAudioClips = audioClips;
}

// ---------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------

const selectTime = (clock: ClockState) => clock.time;
const selectClockPlaying = (clock: ClockState) => clock.playing;
/** Re-seek when the clip drifts further than this from the playhead. */
const DRIFT_SECONDS = 0.25;

function isRenderMode(): boolean {
  const w = motionWindow();
  if (!w) return false;
  return w.__RENDER_MODE === true || new URLSearchParams(window.location.search).get("__render") === "1";
}

function isEmbedded(): boolean {
  return motionWindow()?.__EMBED === true;
}

/** Where the browser fetches a built-in sound from (the app's own route; rendered once by the server). */
export function sfxUrl(name: string): string {
  return `/api/audio/sfx/${encodeURIComponent(name)}`;
}

/** Gain at stage time t for a clip playing over [start, end]. */
export function fadeGain(t: number, start: number, end: number, fadeIn: number, fadeOut: number): number {
  let gain = 1;
  if (fadeIn > 0) gain = Math.min(gain, clamp((t - start) / fadeIn, 0, 1));
  if (fadeOut > 0 && Number.isFinite(end)) gain = Math.min(gain, clamp((end - t) / fadeOut, 0, 1));
  return gain;
}

export function Audio({
  src,
  sfx,
  start = 0,
  end,
  from = 0,
  volume = 1,
  fadeIn = 0,
  fadeOut = 0,
  loop = false,
  style,
  ...rest
}: AudioProps) {
  const time = useClock(selectTime);
  const clockPlaying = useClock(selectClockPlaying);
  const { playing: editorPlaying, muted } = useSyncExternalStore(subscribePlayback, readPlayback, readPlayback);
  const elementRef = useRef<HTMLAudioElement | null>(null);
  const knownLength = sfx && isSfxName(sfx) ? sfxDuration(sfx) : undefined;
  const layerId = typeof rest["data-layer-id"] === "string" ? rest["data-layer-id"] : undefined;
  // A hidden layer (the editor's eye toggle) is silent and left out of exports.
  const hidden = rest["data-hidden"] === true || rest["data-hidden"] === "true";

  // Record the clip for the exporter on every render (props can change).
  useLayoutEffect(() => {
    installGlobal();
    if (hidden || (!src && !(sfx && isSfxName(sfx)))) return;
    const key = layerId ?? `${sfx ?? src}|${start}|${end ?? ""}|${from}`;
    seen.set(key, {
      key,
      ...(src ? { src } : { sfx }),
      start,
      end: end ?? null,
      from,
      volume: clamp(volume, 0, 1),
      fadeIn: Math.max(0, fadeIn),
      fadeOut: Math.max(0, fadeOut),
      loop,
    });
  });

  // One <audio> element per source, outside the document. Never in export.
  useEffect(() => {
    if (isRenderMode()) return;
    const url = src ?? (sfx && isSfxName(sfx) ? sfxUrl(sfx) : null);
    if (!url) return;
    const element = new window.Audio(url);
    element.preload = "auto";
    element.loop = loop;
    elementRef.current = element;
    return () => {
      element.pause();
      element.removeAttribute("src");
      element.load();
      elementRef.current = null;
    };
  }, [src, sfx, loop]);

  // Follow the playhead.
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const playing = editorPlaying || (!isEmbedded() && clockPlaying);
    const naturalEnd = knownLength !== undefined && !loop ? start + knownLength - from : Infinity;
    const stop = end ?? naturalEnd;
    const active = time >= start && time < stop;
    if (!playing || !active || muted || hidden) {
      if (!element.paused) element.pause();
      return;
    }
    const length = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : knownLength;
    let expected = from + (time - start);
    if (loop && length) expected %= length;
    element.volume = clamp(volume, 0, 1) * fadeGain(time, start, stop, fadeIn, fadeOut);
    if (element.paused) {
      element.currentTime = expected;
      void element.play().catch(() => undefined); // autoplay blocked until the first click: stays silent
    } else if (Math.abs(element.currentTime - expected) > DRIFT_SECONDS) {
      element.currentTime = expected;
    }
  }, [time, editorPlaying, clockPlaying, muted, hidden, start, end, from, volume, fadeIn, fadeOut, loop, knownLength]);

  return <span data-audio="" {...rest} style={{ display: "none", ...style }} />;
}

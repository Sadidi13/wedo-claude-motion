/**
 * The runtime clock — one module-level store per document holding the stage
 * time, the standalone `playing` flag and the meta of the Stage that currently
 * owns the window globals (CONTRACTS.md §1).
 *
 * The hooks (`useTime` / `useTimeline` / `useSprite` / `useStage`) read it
 * through `useSyncExternalStore`, so they work anywhere in the preview
 * document: inside the <Stage> subtree, in the component that *renders* the
 * <Stage> (`const t = useTime(); return <Stage>…</Stage>` — the usual Claude
 * Motion authoring pattern) and even before any Stage mounted (time 0,
 * `RUNTIME_DEFAULT_META`).
 *
 * Writers: `window.__seek` (the Stage wraps it in `flushSync`, so the DOM is
 * final when the call returns and the export renderer can screenshot), the
 * standalone rAF loop / scrubber / keyboard, and `useTimeline().setTime /
 * setPlaying`. The registry publishes the meta of its top-most Stage here
 * (`registerStage`); a Stage that unmounts leaves the clock as it is and the
 * next Stage re-registers.
 *
 * Snapshot rule: `getClock()` returns the same object until something changes,
 * and selectors passed to `useClock` must return stable values (a field of the
 * state, not a fresh object), as `useSyncExternalStore` requires.
 */

import { useSyncExternalStore } from "react";
import type { StageMeta } from "@/lib/types";
import { clamp } from "./easing";

/** Stage defaults (CONTRACTS.md §1): what `useStage()` reports before a Stage registered. */
export const RUNTIME_DEFAULT_META: StageMeta = { width: 1280, height: 720, duration: 10, fps: 30 };

export interface ClockState {
  /** stage time in seconds; writes are clamped to [0, meta.duration] */
  time: number;
  /** standalone playback running (a Stage never sets it in embed / render mode) */
  playing: boolean;
  /** meta of the registered Stage; RUNTIME_DEFAULT_META until one mounts */
  meta: StageMeta;
}

const INITIAL: ClockState = { time: 0, playing: false, meta: RUNTIME_DEFAULT_META };

let state: ClockState = INITIAL;
const listeners = new Set<() => void>();

/** The current snapshot (stable identity until the next change). */
export function getClock(): ClockState {
  return state;
}

export function subscribeClock(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function sameMeta(a: StageMeta, b: StageMeta): boolean {
  return (
    a === b ||
    (a.width === b.width &&
      a.height === b.height &&
      a.duration === b.duration &&
      a.fps === b.fps &&
      a.background === b.background)
  );
}

/**
 * Apply a partial update and notify subscribers when something changed.
 * `time` is clamped to the duration of the (new) meta; a non-finite time is
 * ignored. A meta equal by value keeps the previous object so consumers do
 * not re-render.
 */
export function setClock(patch: Partial<ClockState>): void {
  const meta = patch.meta !== undefined && !sameMeta(patch.meta, state.meta) ? patch.meta : state.meta;
  const time =
    patch.time !== undefined && Number.isFinite(patch.time) ? clamp(patch.time, 0, meta.duration) : state.time;
  const playing = patch.playing ?? state.playing;
  if (time === state.time && playing === state.playing && meta === state.meta) return;
  state = { time, playing, meta };
  for (const listener of listeners) listener();
}

/** Back to the initial state (tests; the runtime itself never resets). */
export function resetClock(): void {
  setClock(INITIAL);
}

/**
 * Subscribe a component to one field of the clock. The same selector serves
 * as the server snapshot, so server rendering (and the vitest markup tests)
 * see the clock's current time instead of throwing.
 */
export function useClock<T>(select: (clock: ClockState) => T): T {
  return useSyncExternalStore(
    subscribeClock,
    () => select(state),
    () => select(state),
  );
}

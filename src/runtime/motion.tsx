"use client";
/**
 * Motion Studio runtime — the `./animations.jsx` that project code imports
 * (CONTRACTS.md §1 "Runtime API"). Mirrors the Claude Motion "Stage" starter:
 *
 *   <Stage width height duration fps background>   root, drives the clock
 *   <Sprite start end keepMounted>                 time-windowed layer wrapper
 *   useTime / useTimeline / useSprite / useStage   hooks
 *   Easing / interpolate / animate / clamp / lerp  pure math (see easing.ts)
 *
 * Time lives in a module-level store (clock.ts), not in Stage state, so the
 * hooks work anywhere in the document: in the component that renders the
 * <Stage> (`const t = useTime(); return <Stage>…</Stage>`), in helper
 * components next to it, and inside the Stage subtree. Inside a Stage,
 * `useStage()` / `useSprite()` read the contexts the Stage and Sprite
 * provide; outside they fall back to the clock's registered meta (or the
 * runtime defaults) and to "the whole stage as one sprite".
 *
 * Modes (decided once when a Stage mounts):
 *   embed      window.__EMBED === true — no scaling, no chrome, no autoplay;
 *              time only moves through window.__seek(t) (synchronous render).
 *   render     window.__RENDER_MODE === true or ?__render=1 — like embed, plus
 *              body margin 0 and `[data-export-hide]` hidden (headless export).
 *   standalone neither — rAF playback loop, scrubber, keyboard, scale-to-fit.
 *
 * Every mounted Stage installs window.__videoMeta / __seek / __ready /
 * __getLayerRects / __setTransparent (see registry.ts). Errors thrown by the
 * Stage's children are caught by an internal boundary, reported as a bubbling
 * `motion:error` CustomEvent (detail: { error, time }) on the stage element
 * and retried on the next time change, so the stage and its globals survive.
 */

import React, {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import type { StageMeta } from "@/lib/types";
import { getClock, setClock, useClock, type ClockState } from "./clock";
import { Easing, animate, clamp, interpolate, lerp } from "./easing";
import { motionWindow } from "./globals";
import { registerStage, unregisterStage, type StageHandle } from "./registry";
import { StandaloneFrame } from "./standalone";
import { ensureRuntimeStyles } from "./styles";

export { Easing, animate, clamp, interpolate, lerp };
export type { EasingFn, AnimateSpec } from "./easing";

// ---------------------------------------------------------------------------
// Contexts + hooks
// ---------------------------------------------------------------------------

export interface TimelineState {
  time: number;
  duration: number;
  fps: number;
  playing: boolean;
  setTime: (time: number) => void;
  setPlaying: (playing: boolean) => void;
}

export interface SpriteState {
  /** seconds since the sprite's `start` (clamped to its duration) */
  localTime: number;
  /** 0..1 inside the sprite's window; 0 when the window is infinite or empty */
  progress: number;
  /** `end - start` (may be Infinity) */
  duration: number;
  visible: boolean;
}

const SpriteContext = createContext<SpriteState | null>(null);
const StageContext = createContext<StageMeta | null>(null);

// Selectors return a field of the state (stable values), as useSyncExternalStore requires.
const selectTime = (clock: ClockState) => clock.time;
const selectPlaying = (clock: ClockState) => clock.playing;
const selectMeta = (clock: ClockState) => clock.meta;

function setClockPlaying(playing: boolean): void {
  setClock({ playing });
}

/** Current stage time in seconds. Works anywhere in the document (see clock.ts). */
export function useTime(): number {
  return useClock(selectTime);
}

/** Inside a <Stage>: its meta. Outside: the meta of the registered Stage, or the runtime defaults. */
export function useStage(): StageMeta {
  const context = useContext(StageContext);
  const registered = useClock(selectMeta);
  return context ?? registered;
}

export function useTimeline(): TimelineState {
  const time = useClock(selectTime);
  const playing = useClock(selectPlaying);
  const { duration, fps } = useStage();
  const setTime = useCallback((t: number) => setClock({ time: clamp(t, 0, duration) }), [duration]);
  return useMemo<TimelineState>(
    () => ({ time, duration, fps, playing, setTime, setPlaying: setClockPlaying }),
    [time, duration, fps, playing, setTime],
  );
}

/** Inside a <Sprite>: its local state. Outside any Sprite: the whole stage as one sprite. */
export function useSprite(): SpriteState {
  const sprite = useContext(SpriteContext);
  const time = useClock(selectTime);
  const { duration } = useStage();
  if (sprite) return sprite;
  return {
    localTime: time,
    progress: duration > 0 ? clamp(time / duration, 0, 1) : 0,
    duration,
    visible: true,
  };
}

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

type StageMode = "embed" | "render" | "standalone";

function detectMode(): StageMode {
  const w = motionWindow();
  if (!w) return "standalone";
  if (w.__RENDER_MODE === true) return "render";
  if (new URLSearchParams(window.location.search).get("__render") === "1") return "render";
  if (w.__EMBED === true) return "embed";
  return "standalone";
}

// ---------------------------------------------------------------------------
// Error boundary around the stage's children
// ---------------------------------------------------------------------------

interface BoundaryProps {
  time: number;
  stageRef: RefObject<HTMLDivElement | null>;
  children?: ReactNode;
}

interface BoundaryState {
  error: Error | null;
  /** the time the current children were rendered for; a new time retries after an error */
  time: number;
}

class StageErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, time: this.props.time };

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    return props.time !== state.time ? { time: props.time, error: null } : null;
  }

  static getDerivedStateFromError(thrown: unknown): Partial<BoundaryState> {
    return { error: thrown instanceof Error ? thrown : new Error(String(thrown)) };
  }

  componentDidCatch(thrown: unknown): void {
    const error = thrown instanceof Error ? thrown : new Error(String(thrown));
    const target: EventTarget = this.props.stageRef.current ?? window;
    target.dispatchEvent(
      new CustomEvent("motion:error", { bubbles: true, detail: { error, time: this.props.time } }),
    );
  }

  render(): ReactNode {
    return this.state.error ? null : this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

export interface StageProps {
  width?: number;
  height?: number;
  duration?: number;
  fps?: number;
  background?: string;
  /** standalone mode only */
  loop?: boolean;
  /** standalone mode only */
  autoplay?: boolean;
  children?: ReactNode;
}

export function Stage({
  width = 1280,
  height = 720,
  duration = 10,
  fps = 30,
  background,
  loop = true,
  autoplay = true,
  children,
}: StageProps) {
  const [mode] = useState<StageMode>(detectMode);
  const time = useClock(selectTime);
  const playing = useClock(selectPlaying);
  const [transparent, setTransparentState] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const meta = useMemo<StageMeta>(
    () => ({ width, height, duration, fps, background }),
    [width, height, duration, fps, background],
  );

  const setTime = useCallback((t: number) => setClock({ time: clamp(t, 0, duration) }), [duration]);

  // Host-driven updates (window.__seek / __setTransparent) are flushed synchronously so the DOM
  // is final when the call returns — the export renderer screenshots right after a seek.
  const seek = useCallback((t: number) => flushSync(() => setClock({ time: clamp(t, 0, duration) })), [duration]);
  const setTransparent = useCallback((v: boolean) => flushSync(() => setTransparentState(v)), []);

  useLayoutEffect(() => {
    ensureRuntimeStyles(mode === "render");
    if (mode === "render") document.body.style.margin = "0";
  }, [mode]);

  // One stable handle per Stage instance; its fields are refreshed in place so the
  // registry's position (and the delegating window globals) survive re-renders.
  // Registering also publishes `meta` into the clock for hooks outside this subtree.
  const handleRef = useRef<StageHandle | null>(null);
  useLayoutEffect(() => {
    const handle = handleRef.current ?? { meta, seek, setTransparent, element: () => stageRef.current };
    handleRef.current = handle;
    handle.meta = meta;
    handle.seek = seek;
    handle.setTransparent = setTransparent;
    registerStage(handle);
  }, [meta, seek, setTransparent]);
  useLayoutEffect(() => {
    const handle = handleRef.current;
    return () => {
      if (handle) unregisterStage(handle);
    };
  }, []);

  // Standalone autoplay. Embed / render mode never play: time only moves through __seek.
  useEffect(() => {
    setClock({ playing: mode === "standalone" && autoplay });
  }, [mode, autoplay]);

  // Standalone playback loop (timestamp deltas; loops, or stops at the end when loop=false).
  // Standalone documents hold one Stage, so there is one loop driving the clock.
  useEffect(() => {
    if (mode !== "standalone" || !playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = getClock().time + (now - last) / 1000;
      last = now;
      if (next >= duration && !(loop && duration > 0)) {
        setClock({ time: duration, playing: false });
        return;
      }
      setClock({ time: next >= duration ? next % duration : next });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, playing, duration, loop]);

  const timeline = useMemo<TimelineState>(
    () => ({ time, duration, fps, playing, setTime, setPlaying: setClockPlaying }),
    [time, duration, fps, playing, setTime],
  );

  const stageStyle: CSSProperties = {
    position: "relative",
    width,
    height,
    overflow: "hidden",
    background: transparent ? undefined : background,
  };

  const box = (
    <div ref={stageRef} data-stage="" style={stageStyle}>
      <StageErrorBoundary time={time} stageRef={stageRef}>
        {children}
      </StageErrorBoundary>
    </div>
  );

  return (
    <StageContext.Provider value={meta}>
      {mode === "standalone" ? (
        <StandaloneFrame meta={meta} timeline={timeline}>
          {box}
        </StandaloneFrame>
      ) : (
        box
      )}
    </StageContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Sprite
// ---------------------------------------------------------------------------

export type SpriteChildren = ReactNode | ((state: SpriteState) => ReactNode);

export interface SpriteProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  start?: number;
  end?: number;
  /** keep the subtree mounted (hidden) outside [start, end] */
  keepMounted?: boolean;
  children?: SpriteChildren;
  /** `data-layer-id`, `data-layer-name`, `data-hidden`, … are forwarded to the wrapper div */
  [dataAttribute: `data-${string}`]: string | number | boolean | undefined;
}

export function Sprite({ start = 0, end = Infinity, keepMounted = false, children, style, ...rest }: SpriteProps) {
  const time = useTime();
  const span = end - start;
  const visible = time >= start && time <= end;

  const state = useMemo<SpriteState>(() => {
    const finite = Number.isFinite(span) && span > 0;
    const elapsed = Math.max(0, time - start);
    return {
      localTime: finite ? Math.min(elapsed, span) : elapsed,
      progress: finite ? clamp((time - start) / span, 0, 1) : 0,
      duration: span,
      visible,
    };
  }, [time, start, span, visible]);

  if (!visible && !keepMounted) return null;

  const wrapperStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    ...(visible ? null : { visibility: "hidden" }),
    ...style,
  };

  return (
    <SpriteContext.Provider value={state}>
      <div data-sprite="" {...rest} style={wrapperStyle}>
        {typeof children === "function" ? children(state) : children}
      </div>
    </SpriteContext.Provider>
  );
}

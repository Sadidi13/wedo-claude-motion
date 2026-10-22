/**
 * Hooks outside the <Stage> subtree (CONTRACTS.md §1): the component that
 * renders the Stage — the usual Claude Motion scene shape — may call
 * useTime() & co. Time comes from the runtime clock (clock.ts), so a server
 * render at a given clock time shows the matching Sprite windows, hooks inside
 * the Stage read the very same time, and a document without any Stage does not
 * crash. Effects do not run in SSR, so `playing` stays false and the Stage's
 * meta reaches the clock only through the registry (tested directly).
 */
import React from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import type { StageMeta } from "@/lib/types";
import { RUNTIME_DEFAULT_META, getClock, resetClock, setClock } from "../clock";
import { Sprite, Stage, useSprite, useStage, useTime, useTimeline, type TimelineState } from "../motion";
import { registerStage, unregisterStage, type StageHandle } from "../registry";

/** HTML-escaped quotes restored so JSON payloads can be matched verbatim. */
function render(node: React.ReactNode): string {
  return renderToString(<>{node}</>).replace(/&quot;/g, '"');
}

function Probe({ label }: { label: string }) {
  const time = useTime();
  const stage = useStage();
  const sprite = useSprite();
  const { playing, duration, fps } = useTimeline();
  return <i data-probe={label}>{JSON.stringify({ time, stage, sprite, playing, duration, fps })}</i>;
}

/** The sample scenes' shape: useTime() in the component that renders <Stage>. */
function Scene() {
  const t = useTime();
  const slide = Math.round(t * 100);
  return (
    <Stage width={1920} height={1080} duration={5} fps={30} background="#101418">
      <Sprite start={0} end={2} data-layer-id="early">
        <p style={{ position: "absolute", left: slide }}>early</p>
      </Sprite>
      <Sprite start={3} end={5} data-layer-id="late">
        <p>late</p>
      </Sprite>
      <Sprite start={1} end={4} data-layer-id="mid">
        {({ progress }) => <b>{progress.toFixed(2)}</b>}
      </Sprite>
      <Probe label="inside" />
    </Stage>
  );
}

const fakeHandle = (meta: StageMeta): StageHandle => ({
  meta,
  seek: () => {},
  setTransparent: () => {},
  element: () => null,
});

beforeEach(() => resetClock());

describe("useTime() in the component that renders <Stage>", () => {
  it("renders without throwing, with Sprite windows and values at the clock's time", () => {
    setClock({ time: 1.5 });
    const html = render(<Scene />);
    expect(html).toContain('data-stage=""');
    expect(html).toContain('data-layer-id="early"');
    expect(html).toContain("left:150px");
    expect(html).not.toContain('data-layer-id="late"');
    expect(html).toContain("<b>0.17</b>"); // (1.5 - 1) / 3
  });

  it("follows the clock: later time, other windows", () => {
    setClock({ time: 3.5 });
    const html = render(<Scene />);
    expect(html).not.toContain('data-layer-id="early"');
    expect(html).toContain('data-layer-id="late"');
    expect(html).toContain("<b>0.83</b>");
  });

  it("hooks inside the Stage read the same time; meta comes from the Stage inside and from the clock outside", () => {
    setClock({ time: 2.25 });
    const html = render(
      <>
        <Probe label="outside" />
        <Scene />
      </>,
    );
    expect(html).toContain(
      JSON.stringify({
        time: 2.25,
        stage: { width: 1920, height: 1080, duration: 5, fps: 30, background: "#101418" },
        sprite: { localTime: 2.25, progress: 0.45, duration: 5, visible: true },
        playing: false,
        duration: 5,
        fps: 30,
      }),
    );
    expect(html).toContain(
      JSON.stringify({
        time: 2.25,
        stage: RUNTIME_DEFAULT_META,
        sprite: { localTime: 2.25, progress: 0.225, duration: 10, visible: true },
        playing: false,
        duration: 10,
        fps: 30,
      }),
    );
  });
});

describe("without any Stage mounted", () => {
  it("reports time 0, the runtime defaults and a whole-stage sprite instead of crashing", () => {
    const html = render(<Probe label="alone" />);
    expect(html).toContain(
      JSON.stringify({
        time: 0,
        stage: RUNTIME_DEFAULT_META,
        sprite: { localTime: 0, progress: 0, duration: 10, visible: true },
        playing: false,
        duration: 10,
        fps: 30,
      }),
    );
  });

  it("useTimeline().setTime / setPlaying write to the clock (time clamped to the known duration)", () => {
    const captured: TimelineState[] = [];
    function Capture({ onTimeline }: { onTimeline: (timeline: TimelineState) => void }) {
      onTimeline(useTimeline());
      return null;
    }
    render(<Capture onTimeline={(timeline) => captured.push(timeline)} />);
    const timeline = captured[0];
    if (!timeline) throw new Error("useTimeline() did not run");
    timeline.setTime(42);
    expect(getClock().time).toBe(10);
    timeline.setTime(3);
    expect(getClock().time).toBe(3);
    timeline.setPlaying(true);
    expect(getClock().playing).toBe(true);
  });
});

describe("registry → clock meta", () => {
  it("publishes the top stage's meta, falls back on unmount and keeps the last one afterwards", () => {
    const a = fakeHandle({ width: 640, height: 360, duration: 8, fps: 24 });
    const b = fakeHandle({ width: 100, height: 100, duration: 2, fps: 60 });
    registerStage(a);
    expect(getClock().meta).toBe(a.meta);
    registerStage(b);
    expect(getClock().meta).toBe(b.meta);
    unregisterStage(b);
    expect(getClock().meta).toBe(a.meta);
    unregisterStage(a);
    expect(getClock().meta).toBe(a.meta);
  });

  it("useStage() / useTimeline() outside a Stage report the registered meta", () => {
    const a = fakeHandle({ width: 640, height: 360, duration: 8, fps: 24 });
    registerStage(a);
    try {
      setClock({ time: 6 });
      const html = render(<Probe label="x" />);
      expect(html).toContain('"stage":{"width":640,"height":360,"duration":8,"fps":24}');
      expect(html).toContain('"sprite":{"localTime":6,"progress":0.75,"duration":8,"visible":true}');
      expect(html).toContain('"duration":8,"fps":24}');
    } finally {
      unregisterStage(a);
    }
  });
});

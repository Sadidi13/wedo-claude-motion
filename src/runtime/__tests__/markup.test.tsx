/**
 * Server-rendered markup checks for Stage / Sprite / hooks: verifies the DOM
 * contract (data-stage, data-sprite, forwarded data-* attributes, inline
 * styles, Sprite time windows at t = 0) without a browser. Mode falls back to
 * "standalone" because there is no window; effects do not run in SSR, so the
 * clock (clock.ts) keeps its defaults: time 0, not playing.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Sprite, Stage, useSprite, useStage, useTime, useTimeline } from "../motion";

/** Static markup with HTML-escaped quotes restored so JSON payloads can be matched verbatim. */
function render(node: React.ReactNode): string {
  return renderToStaticMarkup(<>{node}</>).replace(/&quot;/g, '"');
}

describe("Stage markup", () => {
  it("renders a data-stage box with the exact size, overflow hidden and background", () => {
    const html = render(<Stage width={640} height={360} duration={4} fps={24} background="#123456" />);
    expect(html).toContain('data-stage=""');
    expect(html).toMatch(/style="position:relative;width:640px;height:360px;overflow:hidden;background:#123456"/);
  });

  it("applies the contract defaults", () => {
    const html = render(<Stage />);
    expect(html).toMatch(/width:1280px;height:720px/);
  });
});

describe("Sprite markup at t = 0", () => {
  it("renders visible sprites as absolute wrappers and forwards data-* props", () => {
    const html = render(
      <Stage duration={5}>
        <Sprite start={0} end={2} data-layer-id="title" data-layer-name="Title" className="x" style={{ zIndex: 3 }}>
          <h1>Hello</h1>
        </Sprite>
      </Stage>,
    );
    expect(html).toContain('data-sprite=""');
    expect(html).toContain('data-layer-id="title"');
    expect(html).toContain('data-layer-name="Title"');
    expect(html).toContain('class="x"');
    expect(html).toMatch(/style="position:absolute;inset:0;z-index:3"/);
    expect(html).toContain("<h1>Hello</h1>");
  });

  it("omits sprites outside their window unless keepMounted", () => {
    const later = render(
      <Stage duration={5}>
        <Sprite start={1} end={2} data-layer-id="later">
          <p>later</p>
        </Sprite>
      </Stage>,
    );
    expect(later).not.toContain("later");

    const kept = render(
      <Stage duration={5}>
        <Sprite start={1} end={2} keepMounted data-layer-id="kept">
          <p>kept</p>
        </Sprite>
      </Stage>,
    );
    expect(kept).toContain('data-layer-id="kept"');
    expect(kept).toMatch(/visibility:hidden/);
    expect(kept).toContain("<p>kept</p>");
  });

  it("passes { localTime, progress, duration, visible } to function children", () => {
    const html = render(
      <Stage duration={5}>
        <Sprite start={0} end={2}>
          {(s) => <span>{JSON.stringify(s)}</span>}
        </Sprite>
      </Stage>,
    );
    expect(html).toContain(JSON.stringify({ localTime: 0, progress: 0, duration: 2, visible: true }));
  });
});

describe("hooks", () => {
  function Probe() {
    const time = useTime();
    const stage = useStage();
    const sprite = useSprite();
    const timeline = useTimeline();
    return <i>{JSON.stringify({ time, stage, sprite, playing: timeline.playing, fps: timeline.fps })}</i>;
  }

  it("expose stage meta, time 0 and a whole-stage sprite state outside <Sprite>", () => {
    const html = render(
      <Stage width={100} height={50} duration={10} fps={60}>
        <Probe />
      </Stage>,
    );
    expect(html).toContain(
      JSON.stringify({
        time: 0,
        stage: { width: 100, height: 50, duration: 10, fps: 60 },
        sprite: { localTime: 0, progress: 0, duration: 10, visible: true },
        playing: false, // standalone autoplay starts in an effect, which SSR does not run
        fps: 60,
      }),
    );
  });

  it("work outside <Stage> too: clock time 0, the runtime default meta, a whole-stage sprite", () => {
    const html = render(<Probe />);
    expect(html).toContain(
      JSON.stringify({
        time: 0,
        stage: { width: 1280, height: 720, duration: 10, fps: 30 },
        sprite: { localTime: 0, progress: 0, duration: 10, visible: true },
        playing: false,
        fps: 30,
      }),
    );
  });
});

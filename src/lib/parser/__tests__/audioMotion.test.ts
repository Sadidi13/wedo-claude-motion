/** <Audio> layers, data-motion, and the generic attribute setter. */
import { describe, expect, it } from "vitest";
import { sfxDuration } from "@/lib/audio/sfx";
import { parseScene, setLayerAttribute, setLayerMotion, setLayerTiming } from "../index";

const SOURCE = `import { Audio, Sprite, Stage } from "./animations.jsx";

export default function Scene() {
  return (
    <Stage width={1280} height={720} duration={8} fps={30}>
      <Audio src="assets/music.mp3" start={0} end={8} volume={0.8} fadeOut={1.5} loop data-layer-id="music" data-layer-name="Music" />
      <Audio sfx="whoosh" start={1.2} data-layer-id="whoosh" />
      <Audio sfx="pad" start={2} loop data-layer-id="bed" />
      <Sprite start={1} end={5} data-layer-id="title">
        <h1 data-layer-id="title-h1" data-motion='{"x":[[0,-120,"easeOutCubic"],[0.6,0]],"opacity":0.5}'>Hello</h1>
      </Sprite>
    </Stage>
  );
}
`;

describe("<Audio> layers", () => {
  const scene = parseScene(SOURCE);

  it("are timed layers of kind audio with their literal props", () => {
    expect(scene.byId.music).toMatchObject({
      kind: "audio",
      name: "Music",
      start: 0,
      end: 8,
      range: { start: 0, end: 8 },
      audio: { src: "assets/music.mp3", volume: 0.8, fadeOut: 1.5, loop: true },
    });
    expect(scene.byId.music.audio?.sfx).toBeUndefined();
  });

  it("last as long as a built-in sound without end, or to the stage end when looping", () => {
    const length = sfxDuration("whoosh")!;
    expect(scene.byId.whoosh.range).toEqual({ start: 1.2, end: 1.2 + length });
    expect(scene.byId.whoosh.audio).toMatchObject({ sfx: "whoosh", loop: false });
    expect(scene.byId.bed.range).toEqual({ start: 2, end: 8 });
  });

  it("are retimed from the timeline like Sprites", () => {
    const next = setLayerTiming(SOURCE, "whoosh", { start: 3, end: 3.5 });
    expect(next).toContain('<Audio sfx="whoosh" start={3} end={3.5} data-layer-id="whoosh" />');
    expect(parseScene(next).byId.whoosh.range).toEqual({ start: 3, end: 3.5 });
  });
});

describe("data-motion", () => {
  it("is parsed into LayerNode.motion", () => {
    expect(parseScene(SOURCE).byId["title-h1"].motion).toEqual({ x: [[0, -120, "easeOutCubic"], [0.6, 0]], opacity: 0.5 });
    expect(parseScene(SOURCE).byId.title.motion).toBeUndefined();
  });

  it("is written after data-layer-id, replaced, and removed when neutral", () => {
    const set = setLayerMotion(SOURCE, "title", { x: 40, y: -20 });
    expect(set).toContain(`<Sprite start={1} end={5} data-layer-id="title" data-motion='{"x":40,"y":-20}'>`);
    const replaced = setLayerMotion(set, "title", { scale: 1.2 });
    expect(replaced).toContain(`data-layer-id="title" data-motion='{"scale":1.2}'>`);
    expect(setLayerMotion(replaced, "title", { scale: 1, x: 0 })).toBe(SOURCE);
    expect(setLayerMotion(replaced, "title", null)).toBe(SOURCE);
  });
});

describe("setLayerAttribute", () => {
  it("writes numbers, strings and boolean flags as literals and removes with null", () => {
    const louder = setLayerAttribute(SOURCE, "whoosh", "volume", 0.5);
    expect(louder).toContain('<Audio volume={0.5} sfx="whoosh" start={1.2} data-layer-id="whoosh" />');
    expect(setLayerAttribute(louder, "whoosh", "volume", 0.25)).toContain("volume={0.25}");
    expect(setLayerAttribute(louder, "whoosh", "volume", null)).toBe(SOURCE);
    expect(setLayerAttribute(SOURCE, "whoosh", "sfx", 'pop"')).toContain('sfx="pop&quot;"');
    const looped = setLayerAttribute(SOURCE, "whoosh", "loop", true);
    expect(looped).toContain("<Audio loop sfx=");
    expect(setLayerAttribute(looped, "whoosh", "loop", true)).toBe(looped);
    expect(setLayerAttribute(looped, "whoosh", "loop", false)).toBe(SOURCE);
  });

  it("refuses attribute names that are not plain identifiers", () => {
    expect(() => setLayerAttribute(SOURCE, "whoosh", "on click", 1)).toThrow('Invalid attribute name "on click"');
  });
});

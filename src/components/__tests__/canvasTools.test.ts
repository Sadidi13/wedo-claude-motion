/** Pure helpers of the canvas tools: which layer a frame comment points at, and the transform box. */
import { describe, expect, it } from "vitest";
import { parseScene } from "@/lib/parser";
import type { LayerRect } from "@/lib/types";
import { commentPrompt, layerAtPoint } from "../CommentLayer";
import { transformBoxFor } from "../TransformBox";

const SOURCE = `import { Audio, Sprite, Stage } from "./animations.jsx";

export default function Scene() {
  return (
    <Stage width={1000} height={500} duration={6} fps={30}>
      <Sprite start={0} end={6} data-layer-id="bg">
        <div data-layer-id="bg-fill" style={{ position: "absolute", inset: 0 }} />
      </Sprite>
      <Sprite start={0} end={4} data-layer-id="title" data-layer-name="Title">
        <h1 data-layer-id="title-h1">Hello</h1>
      </Sprite>
      <Sprite start={1} end={6} data-layer-id="cards" data-layer-name="Cards">
        <p data-layer-id="card-a">A</p>
        <p data-layer-id="card-b">B</p>
      </Sprite>
      <Audio sfx="whoosh" start={1} data-layer-id="whoosh" />
    </Stage>
  );
}
`;
const scene = parseScene(SOURCE);
const stage: LayerRect = { id: "", x: 0, y: 0, width: 1000, height: 500 };
const rects: LayerRect[] = [
  { ...stage, id: "bg" },
  { ...stage, id: "bg-fill" },
  { ...stage, id: "title" },
  { id: "title-h1", x: 100, y: 100, width: 400, height: 80 },
  { ...stage, id: "cards" },
  { id: "card-a", x: 600, y: 300, width: 100, height: 50 },
  { id: "card-b", x: 750, y: 320, width: 100, height: 80, visible: false },
  { id: "whoosh", x: 0, y: 0, width: 1000, height: 400 },
];

describe("layerAtPoint", () => {
  it("picks the smallest visible layer under the point, skipping full-stage wrappers and sound", () => {
    expect(layerAtPoint(rects, scene, 650, 320)).toBe("card-a");
    expect(layerAtPoint(rects, scene, 800, 360)).toBeNull(); // card-b is not visible at this frame
    expect(layerAtPoint(rects, scene, 50, 50)).toBeNull(); // only the background and the audio marker
  });

  it("names the Sprite when the element is its only child", () => {
    expect(layerAtPoint(rects, scene, 200, 120)).toBe("title");
  });

  it("ignores hidden layers", () => {
    const hidden = parseScene(SOURCE.replace('data-layer-id="card-a"', 'data-layer-id="card-a" data-hidden="true"'));
    expect(layerAtPoint(rects, hidden, 650, 320)).toBeNull();
  });
});

describe("commentPrompt", () => {
  it("adds the time, the point and the layer to the designer's words", () => {
    expect(commentPrompt("  make this bigger ", { x: 649.6, y: 320.2, time: 2.5, layerId: "title" }, scene)).toBe(
      'make this bigger\n\n(Frame comment at 2.50s, at point 650, 320 on the 1000x500 stage, on the layer "Title".)',
    );
    expect(commentPrompt("warmer", { x: 10, y: 10, time: 0, layerId: null }, scene)).toBe(
      "warmer\n\n(Frame comment at 0.00s, at point 10, 10 on the 1000x500 stage.)",
    );
  });
});

describe("transformBoxFor", () => {
  it("uses an element's own box", () => {
    expect(transformBoxFor(scene.byId["card-a"], scene.byId, rects)).toEqual({ id: "card-a", x: 600, y: 300, width: 100, height: 50 });
    expect(transformBoxFor(scene.byId["card-a"], scene.byId, [])).toBeNull();
  });

  it("wraps a Sprite's visible content instead of the whole stage", () => {
    expect(transformBoxFor(scene.byId.title, scene.byId, rects)).toEqual({ x: 100, y: 100, width: 400, height: 80 });
    const both = rects.map((rect) => (rect.id === "card-b" ? { ...rect, visible: true } : rect));
    expect(transformBoxFor(scene.byId.cards, scene.byId, both)).toEqual({ x: 600, y: 300, width: 250, height: 100 });
    expect(transformBoxFor(scene.byId.cards, scene.byId, rects)).toEqual({ x: 600, y: 300, width: 100, height: 50 });
  });

  it("falls back to the Sprite's own box when nothing inside is visible", () => {
    const empty = rects.filter((rect) => !rect.id.startsWith("card-"));
    expect(transformBoxFor(scene.byId.cards, scene.byId, empty)).toEqual({ ...stage, id: "cards" });
  });
});

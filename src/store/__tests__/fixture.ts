/**
 * Small CONTRACTS §1-style scene used by the store tests: a background
 * Sprite, a title Sprite with a function child, a nested group with two
 * plain elements and a Sprite with dynamic timing.
 */
import type { Project } from "@/lib/types";

export const SCENE = `import React from "react";
import { Stage, Sprite, Easing } from "./animations.jsx";

const DELAY = 1;

export default function Scene() {
  return (
    <Stage width={1280} height={720} duration={8} fps={30} background="#0b0b12">
      <Sprite start={0} end={8} data-layer-id="bg" data-layer-name="Background">
        <div data-layer-id="bg-fill" style={{ position: "absolute", inset: 0, background: "#111" }} />
      </Sprite>
      <Sprite start={0.5} end={4} data-layer-id="title" data-layer-name="Title">
        {({ progress }) => (
          <h1 data-layer-id="title-h1" style={{ opacity: progress }}>
            Hello
          </h1>
        )}
      </Sprite>
      <Sprite start={2} end={6} data-layer-id="cards" data-layer-name="Cards">
        <div data-layer-id="row" className="row">
          <p data-layer-id="card-a">A</p>
          <p data-layer-id="card-b">B</p>
        </div>
      </Sprite>
      <Sprite start={DELAY} end={7} data-layer-id="dyn" data-layer-name="Dynamic">
        <p data-layer-id="dyn-text">Later</p>
      </Sprite>
    </Stage>
  );
}
`;

export function makeProject(source = SCENE): Project {
  return {
    id: "test-project",
    name: "Test",
    entry: "scene.jsx",
    files: { "scene.jsx": { path: "scene.jsx", kind: "jsx", content: source } },
    meta: { width: 1280, height: 720, duration: 8, fps: 30, background: "#0b0b12" },
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    origin: "sample",
  };
}

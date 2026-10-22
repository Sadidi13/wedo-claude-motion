/** Shared fixtures for the AI module tests: a small §1-style scene and request builders. */
import type { AiEditRequest, Project } from "@/lib/types";

export const SCENE_SOURCE = `import React from "react";
import { Stage, Sprite, Easing } from "./animations.jsx";

export default function Scene() {
  return (
    <Stage width={1280} height={720} duration={8} fps={30} background="#0b0b12">
      <Sprite start={0} end={8} data-layer-id="bg" data-layer-name="Background">
        <div data-layer-id="bg-fill" style={{ position: "absolute", inset: 0, background: "#111" }} />
      </Sprite>
      <Sprite start={0.5} end={4} data-layer-id="title" data-layer-name="Title">
        {({ progress }) => (
          <h1 data-layer-id="title-h1" style={{ opacity: Easing.easeOutCubic(progress) }}>Hello</h1>
        )}
      </Sprite>
    </Stage>
  );
}
`;

export const STYLES_SOURCE = "h1 { font-family: Inter, sans-serif; }\n";

export function makeProject(entrySource: string | null = SCENE_SOURCE): Project {
  const files: Project["files"] = {
    "styles.css": { path: "styles.css", kind: "css", content: STYLES_SOURCE },
    "assets/logo.png": { path: "assets/logo.png", kind: "asset", content: "data:image/png;base64,AAAA" },
  };
  if (entrySource !== null) files["scene.jsx"] = { path: "scene.jsx", kind: "jsx", content: entrySource };
  return {
    id: "p1",
    name: "Launch",
    entry: "scene.jsx",
    files,
    meta: { width: 1280, height: 720, duration: 8, fps: 30, background: "#0b0b12" },
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    origin: "sample",
  };
}

export function makeRequest(overrides: Partial<AiEditRequest> = {}): AiEditRequest {
  return {
    scope: "layer",
    layerId: "title",
    prompt: "Make the title slide up and fade in faster",
    project: makeProject(),
    ...overrides,
  };
}

/** A valid replacement for the "title" layer of SCENE_SOURCE. */
export const GOOD_LAYER_CODE = `<Sprite start={0.5} end={4} data-layer-id="title" data-layer-name="Title">
  {({ progress }) => (
    <h1 data-layer-id="title-h1" style={{ opacity: progress, transform: \`translateY(\${(1 - progress) * 40}px)\` }}>Hello</h1>
  )}
</Sprite>`;

/** A valid full entry file with one Stage and two layers (ids omitted on purpose). */
export const GOOD_SCENE_CODE = `import React from "react";
import { Stage, Sprite } from "./animations.jsx";

export default function Scene() {
  return (
    <Stage width={1280} height={720} duration={8} fps={30} background="#000">
      <Sprite start={0} end={8} data-layer-name="Background">
        <div style={{ position: "absolute", inset: 0, background: "#123" }} />
      </Sprite>
      <Sprite start={1} end={5} data-layer-name="Title">
        <h1>Hi</h1>
      </Sprite>
    </Stage>
  );
}
`;

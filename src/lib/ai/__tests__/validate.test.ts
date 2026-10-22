/** Output validation tests: import / API detection, layer and scene acceptance and rejection, helper files. */
import { describe, expect, it } from "vitest";
import { parseScene } from "@/lib/parser";
import {
  type ValidationContext,
  findDisallowedImports,
  findForbiddenCalls,
  isAllowedImport,
  stripCodeFence,
  validateAiOutput,
} from "../validate";
import { GOOD_LAYER_CODE, GOOD_SCENE_CODE, SCENE_SOURCE } from "./fixture";

const layerCtx: ValidationContext = { scope: "layer", entryPath: "scene.jsx", entrySource: SCENE_SOURCE, layerId: "title" };
const sceneCtx: ValidationContext = { scope: "scene", entryPath: "scene.jsx", entrySource: SCENE_SOURCE };
const newCtx: ValidationContext = { scope: "new", entryPath: "scene.jsx" };

function expectError(result: ReturnType<typeof validateAiOutput>, needle: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain(needle);
}

describe("findDisallowedImports", () => {
  it("accepts the allowed modules and relative paths", () => {
    const src = `import React from "react";
import ReactDOM from "react-dom/client";
import { Zap } from 'lucide-react';
import { Stage } from "./animations.jsx";
import { Card } from "../shared/Card.jsx";
import "./styles.css";
import type { Foo } from "./types";
const rt = require("@motion/runtime");
export { Stage } from "motion-runtime";`;
    expect(findDisallowedImports(src)).toEqual([]);
  });

  it("flags every other specifier once, across import forms", () => {
    const src = `import { motion } from "framer-motion";
import gsap from 'gsap';
import "https://cdn.example.com/lib.js";
import {
  a,
  b,
} from "three";
export * from "lodash";
const x = require("lodash");
const y = await import("remotion");`;
    expect(findDisallowedImports(src)).toEqual([
      "framer-motion",
      "gsap",
      "https://cdn.example.com/lib.js",
      "three",
      "lodash",
      "remotion",
    ]);
    expect(isAllowedImport("react")).toBe(true);
    expect(isAllowedImport("/abs/path.js")).toBe(false);
  });
});

describe("findForbiddenCalls", () => {
  it("finds wall-clock and random APIs, deduplicated", () => {
    const src = "const a = Math.random(); setTimeout(() => {}, 1); Date.now(); requestAnimationFrame(f); setInterval(f, 1); Math.random();";
    expect(findForbiddenCalls(src)).toEqual(["Math.random", "setTimeout", "Date.now", "requestAnimationFrame", "setInterval"]);
    expect(findForbiddenCalls("const t = useTime(); const r = randomSeed;")).toEqual([]);
  });
});

describe("stripCodeFence", () => {
  it("removes a surrounding markdown fence only", () => {
    expect(stripCodeFence("```jsx\n<div />\n```")).toBe("<div />");
    expect(stripCodeFence("```\n<div />```")).toBe("<div />");
    expect(stripCodeFence("  <div />  ")).toBe("<div />");
    expect(stripCodeFence("<p>```not a fence```</p>")).toBe("<p>```not a fence```</p>");
  });
});

describe("validateAiOutput — layer scope", () => {
  it("accepts one element and returns the canonical source with the id forced", () => {
    const result = validateAiOutput({ summary: "ok", code: GOOD_LAYER_CODE }, layerCtx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layerCode).toContain('data-layer-id="title"');
    expect(result.layerCode).toContain("translateY");
    expect(result.sceneCode).toBeUndefined();
  });

  it("forces the selected id even when the model changed or dropped it, and ids new nested elements", () => {
    const code = '<Sprite start={0.5} end={4} data-layer-id="renamed"><h1 data-layer-id="title-h1">A</h1><p>new</p></Sprite>';
    const result = validateAiOutput({ summary: "ok", code }, layerCtx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layerCode).toMatch(/^<Sprite start=\{0\.5\} end=\{4\} data-layer-id="title">/);
    expect(result.layerCode).toContain('data-layer-id="title-h1"');
    expect(result.layerCode).toMatch(/<p data-layer-id="p-[a-z0-9]{6}">new<\/p>/);
  });

  it("strips a markdown fence before validating", () => {
    const result = validateAiOutput({ summary: "ok", code: "```jsx\n" + GOOD_LAYER_CODE + "\n```" }, layerCtx);
    expect(result.ok).toBe(true);
  });

  it("rejects more than one element, fragments-with-siblings and syntax errors", () => {
    expectError(validateAiOutput({ summary: "ok", code: "<div /><div />" }, layerCtx), "Adjacent JSX elements");
    expectError(validateAiOutput({ summary: "ok", code: "<><div /><div /></>" }, layerCtx), "exactly one JSX element");
    expectError(validateAiOutput({ summary: "ok", code: "const x = 1;" }, layerCtx), "exactly one JSX element");
    expectError(validateAiOutput({ summary: "ok", code: "<Sprite start={0}><h1>oops</Sprite>" }, layerCtx), "could not be spliced");
  });

  it("rejects empty code, empty summary, forbidden calls and imports", () => {
    expectError(validateAiOutput({ summary: "ok", code: "   " }, layerCtx), "`code` is empty");
    expectError(validateAiOutput({ summary: " ", code: GOOD_LAYER_CODE }, layerCtx), "`summary` is empty");
    expectError(
      validateAiOutput({ summary: "ok", code: '<div data-layer-id="title" style={{ left: Math.random() }} />' }, layerCtx),
      "forbidden time/random API(s): Math.random",
    );
    expectError(
      validateAiOutput({ summary: "ok", code: '<div data-layer-id="title">{require("gsap")}</div>' }, layerCtx),
      'disallowed module(s): "gsap"',
    );
  });

  it("rejects when the layer id is unknown", () => {
    expectError(validateAiOutput({ summary: "ok", code: GOOD_LAYER_CODE }, { ...layerCtx, layerId: "nope" }), "not found");
  });
});

describe("validateAiOutput — scene / new scope", () => {
  it("accepts a full entry file and assigns missing ids", () => {
    const result = validateAiOutput({ summary: "ok", code: GOOD_SCENE_CODE }, sceneCtx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layerCode).toBeUndefined();
    const scene = parseScene(result.sceneCode ?? "");
    expect(scene.layers).toHaveLength(2);
    expect(scene.layers[0].name).toBe("Background");
    expect(result.sceneCode).toMatch(/<Sprite data-layer-id="sprite-[a-z0-9]{6}" start=\{0\}/);
    expect(validateAiOutput({ summary: "ok", code: GOOD_SCENE_CODE }, newCtx).ok).toBe(true);
  });

  it("rejects files without exactly one Stage", () => {
    expectError(validateAiOutput({ summary: "ok", code: "export default () => <div />;" }, sceneCtx), "No <Stage>");
    const two = GOOD_SCENE_CODE.replace("<h1>Hi</h1>", "<h1>Hi</h1>\n        <Stage width={1} height={1} duration={1} fps={1} />");
    expectError(validateAiOutput({ summary: "ok", code: two }, sceneCtx), "exactly one <Stage>");
  });

  it("rejects an empty Stage, a missing default export and syntax errors", () => {
    expectError(
      validateAiOutput({ summary: "ok", code: 'export default () => <Stage width={1} height={1} duration={1} fps={1}></Stage>;' }, sceneCtx),
      "no layers",
    );
    const noExport = GOOD_SCENE_CODE.replace("export default function Scene", "function Scene");
    expectError(validateAiOutput({ summary: "ok", code: noExport }, sceneCtx), "export default");
    expectError(validateAiOutput({ summary: "ok", code: GOOD_SCENE_CODE.replace("</Stage>", "") }, sceneCtx), "does not parse");
  });

  it("accepts a ReactDOM.createRoot render instead of a default export", () => {
    const code = GOOD_SCENE_CODE.replace("export default function Scene", "function Scene") +
      '\nimport ReactDOM from "react-dom/client";\nReactDOM.createRoot(document.getElementById("root")).render(<Scene />);\n';
    expect(validateAiOutput({ summary: "ok", code }, sceneCtx).ok).toBe(true);
  });

  it("rejects disallowed imports and forbidden calls in the entry file", () => {
    const withGsap = GOOD_SCENE_CODE.replace('import React from "react";', 'import React from "react";\nimport gsap from "gsap";');
    expectError(validateAiOutput({ summary: "ok", code: withGsap }, newCtx), 'disallowed module(s): "gsap"');
    const withTimer = GOOD_SCENE_CODE.replace("<h1>Hi</h1>", "<h1>{setTimeout(() => 1, 0)}</h1>");
    expectError(validateAiOutput({ summary: "ok", code: withTimer }, newCtx), "setTimeout");
  });
});

describe("validateAiOutput — helper files", () => {
  it("passes safe files through and drops an empty list", () => {
    const files = [{ path: " styles.css ", content: "h1 { color: red }" }, { path: "components/Card.jsx", content: 'import React from "react";' }];
    const result = validateAiOutput({ summary: "ok", code: GOOD_LAYER_CODE, files }, layerCtx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files).toEqual([
      { path: "styles.css", content: "h1 { color: red }" },
      { path: "components/Card.jsx", content: 'import React from "react";' },
    ]);
    const none = validateAiOutput({ summary: "ok", code: GOOD_LAYER_CODE, files: [] }, layerCtx);
    expect(none.ok && none.files).toBeUndefined();
  });

  it("rejects unsafe paths, the entry file and disallowed imports inside files", () => {
    for (const path of ["../x.css", "/abs.css", "a/../b.css", "a\\b.css", "", "./x.css"]) {
      expectError(validateAiOutput({ summary: "ok", code: GOOD_LAYER_CODE, files: [{ path, content: "" }] }, layerCtx), "not a safe relative");
    }
    expectError(
      validateAiOutput({ summary: "ok", code: GOOD_LAYER_CODE, files: [{ path: "scene.jsx", content: "" }] }, layerCtx),
      "must not contain the entry file",
    );
    expectError(
      validateAiOutput({ summary: "ok", code: GOOD_LAYER_CODE, files: [{ path: "Card.tsx", content: 'import x from "three";' }] }, layerCtx),
      'File "Card.tsx" imports disallowed module(s): "three"',
    );
  });
});

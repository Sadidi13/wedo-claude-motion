/** Prompt builder tests: stable system prompt content, cached system block, user-turn content blocks, history ordering. */
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { parseScene } from "@/lib/parser";
import { SYSTEM_PROMPT, ancestorChain, buildMessages, buildSystem, buildUserMessage, layerTreeLines, numberLines } from "../prompts";
import { SCENE_SOURCE, STYLES_SOURCE, makeProject, makeRequest } from "./fixture";

const scene = parseScene(SCENE_SOURCE);

function textOf(blocks: Anthropic.ContentBlockParam[]): string {
  return blocks.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
}

describe("SYSTEM_PROMPT", () => {
  it("contains the runtime API table, allowed imports, id rule, quality and output rules", () => {
    for (const needle of [
      "| `Stage` |",
      "| `Sprite` |",
      "| `useSprite()` |",
      "| `interpolate(input: number[], output: number[], easing?)` |",
      "| `animate({ from, to, start, end, ease? })` |",
      "easeOutCubic",
      "easeOutElastic",
      "`./animations.jsx`",
      "`lucide-react`",
      "`@motion/runtime`",
      "`data-layer-id`",
      "`data-layer-name`",
      "every direct child of `<Stage>` is a top-level layer",
      "80-200 ms",
      "5% of the canvas",
      ">= 24 px",
      "No CSS `transition`, `animation` or `@keyframes`",
      "`Math.random()`",
      'scope "layer": `code` is exactly ONE JSX element',
      'scope "scene": `code` is the complete entry file',
      'scope "new": `code` is a complete new entry file',
      "Persian",
      "`summary`",
      "`files` (optional)",
    ]) {
      expect(SYSTEM_PROMPT).toContain(needle);
    }
  });

  it("is a single cached system block", () => {
    const system = buildSystem();
    expect(system).toHaveLength(1);
    expect(system[0]).toEqual({ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } });
  });
});

describe("numberLines", () => {
  it("prefixes 1-based numbers padded to the widest line number", () => {
    expect(numberLines("a\nb")).toBe("1 | a\n2 | b");
    const ten = numberLines(Array.from({ length: 10 }, (_, i) => `l${i}`).join("\n"));
    expect(ten.startsWith(" 1 | l0\n")).toBe(true);
    expect(ten.endsWith("10 | l9")).toBe(true);
  });
});

describe("layer overview helpers", () => {
  it("lists the tree with ids, names, tags and ranges", () => {
    const lines = layerTreeLines(scene);
    expect(lines[0]).toBe('- bg "Background" <Sprite> visible 0s–8s start=0 end=8');
    expect(lines[1]).toBe('  - bg-fill "<div>" <div> visible 0s–8s');
    expect(lines[2]).toBe('- title "Title" <Sprite> visible 0.5s–4s start=0.5 end=4');
  });

  it("builds the ancestor chain root first", () => {
    expect(ancestorChain(scene, "title")).toBe("Stage (0s–8s)");
    expect(ancestorChain(scene, "title-h1")).toBe('Stage (0s–8s) › Sprite#title "Title" (0.5s–4s)');
  });
});

describe("buildUserMessage", () => {
  it("includes task, stage meta, line-numbered source, other files, selected layer and the instruction", () => {
    const req = makeRequest();
    const blocks = buildUserMessage(req, scene);
    expect(blocks.map((b) => b.type)).toEqual(["text", "text"]);
    const text = textOf(blocks);
    expect(text).toContain('Scope "layer": replace the selected layer');
    expect(text).toContain('Project: "Launch" · entry file: scene.jsx');
    expect(text).toContain("Stage: 1280×720px, 8s at 30 fps, background #0b0b12");
    expect(text).toMatch(/^\s*1 \| import React from "react";$/m);
    expect(text).toMatch(/^\s*6 \| {5}<Stage width=\{1280\}/m);
    expect(text).toContain(`- styles.css (css, ${STYLES_SOURCE.length} B)\n\`\`\`css\n${STYLES_SOURCE.trim()}\n\`\`\``);
    expect(text).toMatch(/- assets\/logo\.png \(asset, \d+ B\)\n/);
    expect(text).not.toContain("data:image/png;base64");
    expect(text).toContain("# Selected layer\ntitle \"Title\" <Sprite> visible 0.5s–4s start=0.5 end=4 · line 10");
    expect(text).toContain("Ancestors: Stage (0s–8s)");
    expect(text).toContain('<Sprite start={0.5} end={4} data-layer-id="title" data-layer-name="Title">');
    expect(text).toContain('- title "Title" <Sprite> visible 0.5s–4s');
    const last = blocks[blocks.length - 1];
    expect(last.type === "text" && last.text).toContain(`# Instruction\n${req.prompt}`);
    expect(last.type === "text" && last.text).toContain("Respond with the JSON object");
  });

  it("adds the frame screenshot as an image block before the instruction", () => {
    const req = makeRequest({ frameImage: { mediaType: "image/png", data: "iVBORw0KGgo=" } });
    const blocks = buildUserMessage(req, scene);
    expect(blocks.map((b) => b.type)).toEqual(["text", "image", "text"]);
    expect(blocks[1]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" },
    });
    expect(textOf(blocks)).toContain("The attached screenshot shows the current frame");
  });

  it("omits the selected-layer section for scene scope", () => {
    const text = textOf(buildUserMessage(makeRequest({ scope: "scene", layerId: undefined }), scene));
    expect(text).toContain('Scope "scene"');
    expect(text).not.toContain("# Selected layer");
    expect(text).toMatch(/^\s*1 \| import React/m);
  });

  it("handles a project without an entry file for scope new", () => {
    const req = makeRequest({ scope: "new", layerId: undefined, project: makeProject(null), prompt: "یک معرفی محصول بساز" });
    const text = textOf(buildUserMessage(req, null));
    expect(text).toContain('Scope "new"');
    expect(text).toContain("(no entry file yet — create it)");
    expect(text).toContain("Stage: 1280×720px, 8s at 30 fps, background #0b0b12");
    expect(text).not.toContain("# Layers");
    expect(text).toContain("یک معرفی محصول بساز");
  });

  it("truncates very large helper files instead of dumping them", () => {
    const project = makeProject();
    project.files["big.jsx"] = { path: "big.jsx", kind: "jsx", content: "x".repeat(10_000) };
    const text = textOf(buildUserMessage(makeRequest({ project }), scene));
    expect(text).toContain("- big.jsx (jsx, 9.8 KB)");
    expect(text).toContain("… (truncated)");
    expect(text).not.toContain("x".repeat(6_001));
  });
});

describe("buildMessages", () => {
  it("puts cleaned history before the final user turn", () => {
    const req = makeRequest({
      history: [
        { role: "assistant", content: "dropped: nothing before it" },
        { role: "user", content: "make it red" },
        { role: "assistant", content: "Done, it is red." },
        { role: "user", content: "   " },
      ],
    });
    const messages = buildMessages(req, scene);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(messages[0].content).toBe("make it red");
    expect(messages[1].content).toBe("Done, it is red.");
    expect(Array.isArray(messages[2].content)).toBe(true);
  });

  it("is just the user turn without history", () => {
    const messages = buildMessages(makeRequest(), scene);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
  });
});

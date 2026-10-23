/**
 * Prompt construction for the Claude routes (CONTRACTS §5).
 *
 * `SYSTEM_PROMPT` is the stable, cacheable part: the authoring contract (§1),
 * the runtime API table, 3D (three.js) rules with one example, export rules,
 * motion-design guidance and the output rules per scope. It must never
 * contain anything request-specific, because
 * it is sent with `cache_control: { type: "ephemeral" }` and a single changed
 * byte invalidates the cache.
 *
 * Everything volatile (stage meta, line-numbered entry source, other project
 * files, the selected layer with its ancestor chain, the instruction and the
 * optional frame screenshot) goes into the final user turn built by
 * `buildUserMessage`. `buildMessages` puts the designer's prior turns before
 * that final turn so they can iterate on the same layer.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { getLayerSource } from "@/lib/parser";
import type { AiEditRequest, AiScope, LayerNode, ParsedScene, ProjectFile, StageMeta } from "@/lib/types";

export const SYSTEM_PROMPT = `You are the motion-design engine inside Motion Studio, a layer-based editor for Claude Motion / Claude Design animations. A designer selects one layer (or the whole scene) in the editor, writes an instruction, and you answer with code. The editor splices your code straight back into the project and re-renders it, so the output must be exact, complete and self-contained. Nothing you write is shown as prose except \`summary\`.

# 1. Authoring contract (the code you return must follow it)

- A scene is one JSX entry file (usually \`scene.jsx\`) whose default export renders exactly ONE \`<Stage>\`. Its \`width\`, \`height\`, \`duration\`, \`fps\` and \`background\` props are numeric / string literals so the editor can read and edit them.
- Motion is a pure function of time. Read time only through \`useTime()\`, \`useSprite()\`, \`<Sprite start end>\`, \`interpolate()\`, \`animate()\` and \`Easing.*\`; the hooks may be called in the component that renders \`<Stage>\` (e.g. \`const t = useTime();\` at the top of \`Scene\`) as well as in any component inside it. Rendering the same time twice must produce identical pixels.
- Layers: every direct child of \`<Stage>\` is a top-level layer; nested JSX elements are sub-layers. When you create or restructure a scene, make each visual element (background, title, subtitle, each card, each bar, logo, CTA, ...) its own \`<Sprite start={...} end={...} data-layer-name="...">\` with a short descriptive name, so the layers panel shows a clean, editable list. Only group elements in one Sprite when they move as a unit.
- \`data-layer-id\`: every JSX element inside the Stage subtree carries a stable \`data-layer-id="..."\`. These ids are how the editor maps layers to code. NEVER remove, rename or move an existing id onto a different element. Elements you add may omit the attribute (the editor assigns one) or use a fresh unique id. Optional attributes: \`data-layer-name\`, \`data-hidden="true"\`, \`data-locked="true"\`.
- \`<Sprite start={n} end={n}>\` timing props are numeric literals in seconds so the designer can drag them on the timeline. Keep existing timing unless asked to change it.
- Allowed imports: \`react\`, \`react-dom\`, \`react-dom/client\`, \`lucide-react\`, \`three\` (three.js 0.186, the main module only; see section 3), the runtime (\`./animations.jsx\`, \`./animations\`, \`@motion/runtime\`, \`motion-runtime\`) and relative project files (\`./Card.jsx\`, \`./styles.css\`). Nothing else: no URLs, no three.js addons (\`three/addons/...\`), no other npm packages (no framer-motion, gsap, remotion, ...).
- Assets are referenced by relative path (\`assets/logo.png\`). Only reference asset files that exist in the project.

# 2. Runtime API (\`import { ... } from "./animations.jsx"\`)

| export | signature | notes |
|---|---|---|
| \`Stage\` | \`({ width=1280, height=720, duration=10, fps=30, background, loop=true, autoplay=true, children })\` | root; renders a \`position:relative; overflow:hidden\` box of exactly width x height |
| \`Sprite\` | \`({ start=0, end=Infinity, keepMounted=false, children, ...rest })\` | visible when \`start <= time <= end\`, otherwise unmounted (or hidden when \`keepMounted\`). \`children\` may be a function \`({ localTime, progress, duration, visible }) => node\`. Renders a wrapper \`<div data-sprite style="position:absolute;inset:0">\` carrying the \`data-*\` props |
| \`useTime()\` | \`() => number\` | current time in seconds |
| \`useTimeline()\` | \`() => { time, duration, fps, playing, setTime, setPlaying }\` | |
| \`useSprite()\` | \`() => { localTime, progress, duration, visible }\` | inside a Sprite; \`progress\` runs 0 -> 1 over the Sprite's range |
| \`useStage()\` | \`() => { width, height, duration, fps, background }\` | |
| \`Easing\` | object of \`(t: number) => number\` | \`linear, easeInQuad, easeOutQuad, easeInOutQuad, easeInCubic, easeOutCubic, easeInOutCubic, easeInQuart, easeOutQuart, easeInOutQuart, easeInExpo, easeOutExpo, easeInOutExpo, easeOutBack, easeInBack, easeInOutBack, easeOutElastic, easeOutBounce\` |
| \`interpolate(input: number[], output: number[], easing?)\` | \`(t: number) => number\` | piecewise linear with clamping; \`easing\` is one function or one per segment |
| \`animate({ from, to, start, end, ease? })\` | \`(t: number) => number\` | single tween, default \`Easing.easeInOutCubic\` |
| \`clamp(v, min, max)\`, \`lerp(a, b, t)\` | helpers | |
| \`Three3D\` | \`({ setup?, render?, width?, height?, camera?, textures?, antialias=true, autoRender=true, ...data-* })\` | one three.js scene drawn on one WebGL canvas, as ONE layer (stage-sized by default); see section 3 |

Globals installed by the runtime (\`window.__videoMeta\`, \`window.__seek\`, \`window.__ready\`) are for the exporter; never read or write them.

# 3. 3D scenes (three.js)

Use 3D when the idea needs depth (a camera moving through objects, lit products, a space); everything else stays 2D HTML.

- Draw with the runtime's \`<Three3D>\`, inside a \`<Sprite>\` for its timing, with a \`data-layer-name\`. It is one layer: the meshes inside it are not separate layers. Titles and captions go in their own Sprites above it as normal HTML text, not inside the 3D scene.
- \`setup({ THREE, scene, camera, renderer, width, height, textures })\` runs once: create geometries, materials and lights, add them to \`scene\`, and return the objects you animate. It must not depend on time.
- \`render(t, frame)\` runs for every frame: \`t\` is the stage time; \`frame\` holds the setup context plus \`state\` (what setup returned), \`localTime\` and \`progress\` of the enclosing Sprite. Set every moving property to an absolute value computed from \`t\` (\`mesh.rotation.y = t * 0.8\`, \`camera.position.z = dolly(t)\` with \`const dolly = interpolate([0, 5], [14, 3], Easing.easeInOutCubic)\`), never increment it (\`+=\`): frames are rendered out of order. The runtime then calls \`renderer.render(scene, camera)\`; pass \`autoRender={false}\` only when \`render\` draws itself.
- Never start a loop or a clock: no \`renderer.setAnimationLoop\`, \`requestAnimationFrame\`, \`THREE.Clock\`, \`performance.now()\` or \`Math.random()\`. For variety use \`THREE.MathUtils.seededRandom(i + 1)\` (same value for the same seed). Animation clips: \`mixer.setTime(t)\`, never \`mixer.update(delta)\`.
- Images on 3D objects: \`textures={{ logo: "assets/logo.png" }}\`, then \`textures.logo\` in setup (decoded, sRGB; the frame waits for it). No \`TextureLoader\`, loaders or \`fetch\`: they finish late and frames would miss them. Text on a 3D object: draw it on a 2D canvas in setup and use \`new THREE.CanvasTexture(canvas)\`.
- \`import * as THREE from "three"\` (or \`THREE\` from the setup context). Only the main module: no addons such as OrbitControls, GLTFLoader, EffectComposer / bloom or TextGeometry.
- Lit materials (\`MeshStandardMaterial\`, \`MeshPhysicalMaterial\`) need lights: a soft \`HemisphereLight\` or \`AmbientLight\` plus one \`DirectionalLight\` as the key light. Keep geometry modest: export renders every frame at full resolution.
- The canvas is transparent where nothing is drawn, so the Stage background and the layers below show through; set \`scene.background = new THREE.Color("#…")\` for an opaque 3D backdrop.

Example: a camera dolly through lit boxes, then a title lands.

\`\`\`jsx
import React from "react";
import * as THREE from "three";
import { Stage, Sprite, Three3D, interpolate, Easing } from "./animations.jsx";

const dolly = interpolate([0, 5], [14, 3], Easing.easeInOutCubic);

export default function Scene() {
  return (
    <Stage width={1080} height={1920} duration={6} fps={30} background="#07080d">
      <Sprite start={0} end={6} data-layer-name="3D boxes">
        <Three3D
          camera={{ fov: 50 }}
          setup={({ scene }) => {
            scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x10131c, 0.8));
            const key = new THREE.DirectionalLight(0xffffff, 2.4);
            key.position.set(4, 6, 5);
            scene.add(key);
            const geometry = new THREE.BoxGeometry(1, 1, 1);
            const boxes = Array.from({ length: 12 }, (_, i) => {
              const box = new THREE.Mesh(
                geometry,
                new THREE.MeshStandardMaterial({ color: i % 3 === 0 ? 0xff5a36 : 0x2b3350, roughness: 0.35 }),
              );
              box.position.set((i % 2 ? 1 : -1) * (1.4 + THREE.MathUtils.seededRandom(i + 1)), (i % 3) - 1, 2 - i * 1.4);
              scene.add(box);
              return box;
            });
            return { boxes };
          }}
          render={(t, { camera, state }) => {
            camera.position.set(0, 0.4, dolly(t));
            camera.lookAt(0, 0, -20);
            state.boxes.forEach((box, i) => box.rotation.set(t * 0.4 + i, t * 0.6 + i * 0.5, 0));
          }}
        />
      </Sprite>
      <Sprite start={3.6} end={6} data-layer-name="Title">
        {({ localTime }) => {
          const p = Easing.easeOutCubic(Math.min(localTime / 0.7, 1));
          return (
            <h1 style={{ position: "absolute", left: 80, right: 80, bottom: 360, margin: 0, color: "#fff", font: "800 120px/1 system-ui, sans-serif", opacity: p, transform: \`translateY(\${(1 - p) * 60}px)\` }}>
              Into the depth
            </h1>
          );
        }}
      </Sprite>
    </Stage>
  );
}
\`\`\`

# 4. Export rules (frames are rendered headlessly by seeking time)

- No CSS \`transition\`, \`animation\` or \`@keyframes\` on anything that moves. No \`requestAnimationFrame\`, \`setTimeout\`, \`setInterval\`, \`Math.random()\`, \`Date.now()\`, \`new Date()\`, timers, promises or network in render paths. Everything derives from the time the runtime gives you.
- No \`window\` / \`document\` access, no event handlers that change the picture, no React state that depends on wall-clock time.
- Position elements with inline \`style\` objects (\`position: "absolute"\`) inside the Stage; the Stage width / height is the coordinate system. Fonts: system / web-safe stacks or fonts already loaded by the project.

# 5. Motion-design quality bar

- Easing: entrances \`easeOutCubic\` / \`easeOutQuart\` / \`easeOutExpo\`; exits \`easeInCubic\`; movement between positions \`easeInOutCubic\`; \`easeOutBack\` / \`easeOutElastic\` only for one playful accent. Avoid \`linear\` except for continuous motion (rotation, scrolling, progress).
- Timing: entrances 0.3-0.8 s; stagger sibling elements by 80-200 ms; let elements overlap instead of playing strictly one after another; hold readable content long enough to read (>= 1.5 s for a sentence).
- Hierarchy: one focal element at a time; secondary elements smaller, dimmer, later.
- Layout: keep everything inside safe margins of at least 5% of the canvas on every side; align to a simple grid; body text >= 24 px and titles >= 48 px at 1080p (scale proportionally for other canvas sizes).
- Colour: a limited palette (2-3 brand colours plus neutrals), text contrast >= 4.5:1 against its background, consistent corner radii and shadows.
- Prefer transform-based motion (translate / scale / opacity) over layout-affecting properties.

# 6. Output format

Return ONLY a JSON object with these fields (no Markdown, no code fences inside strings):
- \`summary\`: one short paragraph describing what you changed and why. Write it in the SAME LANGUAGE as the designer's instruction: Persian (فارسی) for a Persian instruction, English for an English one.
- \`code\`: the code for the requested scope (see below).
- \`files\` (optional): array of \`{ "path", "content" }\` for NEW or UPDATED helper files (\`styles.css\`, \`Card.jsx\`, ...) referenced by \`code\`. Relative paths only. Never put the entry file itself or binary assets here. Omit when nothing else changed.

Scope rules:
- scope "layer": \`code\` is exactly ONE JSX element that replaces the selected element in place. Keep its root tag unless asked otherwise, keep the root \`data-layer-id\` exactly, keep nested ids for elements that still exist. No imports, no \`<Stage>\`, no sibling layers, no fragment wrapper, no surrounding function. It must be valid JSX on its own, using only identifiers already available in the file (runtime exports, imported components, and props in scope such as \`progress\` from a Sprite function-child).
- scope "scene": \`code\` is the complete entry file: imports, the default-exported component, exactly one \`<Stage>\` with the same literal props unless asked to change them, and every layer (existing ids preserved; untouched layers byte-identical where possible).
- scope "new": \`code\` is a complete new entry file that starts with \`import React from "react";\` and \`import { Stage, Sprite, useTime, useSprite, Easing, interpolate, animate } from "./animations.jsx";\`, exports a default component rendering one \`<Stage>\` with the canvas size, duration, fps and background given in the task, and makes every visual element its own named \`<Sprite>\`.`;

/** Source kinds whose content is worth showing to the model (assets are data URLs, html is pre-import). */
const TEXT_SOURCE_KINDS = new Set<ProjectFile["kind"]>(["jsx", "js", "tsx", "ts", "css"]);
/** Per-file and total caps for other source files included in the user turn. */
const MAX_OTHER_FILE_CHARS = 6_000;
const MAX_OTHER_FILES_TOTAL_CHARS = 24_000;
/** Cap for the layer overview so huge generated scenes do not flood the prompt. */
const MAX_TREE_LINES = 200;

const SCOPE_TASK: Record<AiScope, string> = {
  layer: 'Scope "layer": replace the selected layer with exactly ONE JSX element that keeps the same data-layer-id.',
  scene: 'Scope "scene": rewrite the whole entry file (one <Stage>, all layers, existing data-layer-ids preserved).',
  new: 'Scope "new": create a complete new entry file from scratch for the Stage described below.',
};

const CODE_FENCE_BY_KIND: Record<string, string> = { css: "css", ts: "ts", tsx: "tsx", js: "js", jsx: "jsx" };

/** Prefix every line with its 1-based number: `  7 | <Sprite ...>`. */
export function numberLines(source: string): string {
  const lines = source.split(/\r?\n/);
  const width = String(lines.length).length;
  return lines.map((line, i) => `${String(i + 1).padStart(width, " ")} | ${line}`).join("\n");
}

function formatSeconds(value: number): string {
  if (!Number.isFinite(value)) return "∞";
  return `${Number(value.toFixed(3))}s`;
}

function formatRange(range: { start: number; end: number }): string {
  return `${formatSeconds(range.start)}–${formatSeconds(range.end)}`;
}

function formatBytes(chars: number): string {
  return chars < 1024 ? `${chars} B` : `${(chars / 1024).toFixed(1)} KB`;
}

function describeStage(meta: StageMeta): string {
  const background = meta.background ? meta.background : "transparent";
  return `${meta.width}×${meta.height}px, ${formatSeconds(meta.duration)} at ${meta.fps} fps, background ${background}`;
}

function describeLayer(node: LayerNode): string {
  const flags = [node.hidden ? "hidden" : "", node.locked ? "locked" : ""].filter(Boolean);
  const own =
    node.start !== undefined || node.end !== undefined
      ? ` start=${node.start ?? 0} end=${node.end === undefined ? "∞" : node.end}`
      : "";
  return `${node.id} "${node.name}" <${node.tag}> visible ${formatRange(node.range)}${own}${flags.length ? ` (${flags.join(", ")})` : ""}`;
}

/** Indented overview of the whole layer tree (ids, names, tags, visible ranges). */
export function layerTreeLines(scene: ParsedScene): string[] {
  const lines: string[] = [];
  const walk = (nodes: LayerNode[], depth: number) => {
    for (const node of nodes) {
      if (lines.length >= MAX_TREE_LINES) return;
      lines.push(`${"  ".repeat(depth)}- ${describeLayer(node)}`);
      walk(node.children, depth + 1);
    }
  };
  walk(scene.layers, 0);
  if (lines.length >= MAX_TREE_LINES) lines.push("- … (tree truncated)");
  return lines;
}

/** `Stage › Sprite#hero "Hero" (0s–8s) › div#card "Card" (0s–8s)` for the layer's ancestors (root first). */
export function ancestorChain(scene: ParsedScene, id: string): string {
  const chain: string[] = [];
  let current = scene.byId[id]?.parentId ?? null;
  while (current) {
    const node = scene.byId[current];
    if (!node) break;
    chain.unshift(`${node.tag}#${node.id} "${node.name}" (${formatRange(node.range)})`);
    current = node.parentId;
  }
  chain.unshift(`Stage (0s–${formatSeconds(scene.meta.duration)})`);
  return chain.join(" › ");
}

function otherFilesSection(req: AiEditRequest): string {
  const files = Object.values(req.project.files).filter((f) => f.path !== req.project.entry);
  if (files.length === 0) return "# Other project files\n(none)";
  let budget = MAX_OTHER_FILES_TOTAL_CHARS;
  const parts = files.map((file) => {
    const header = `- ${file.path} (${file.kind}, ${formatBytes(file.content.length)})`;
    if (!TEXT_SOURCE_KINDS.has(file.kind) || budget <= 0) return header;
    const limit = Math.min(MAX_OTHER_FILE_CHARS, budget);
    const truncated = file.content.length > limit;
    const body = truncated ? `${file.content.slice(0, limit)}\n… (truncated)` : file.content.trimEnd();
    budget -= Math.min(file.content.length, limit);
    return `${header}\n\`\`\`${CODE_FENCE_BY_KIND[file.kind] ?? ""}\n${body}\n\`\`\``;
  });
  return `# Other project files\n${parts.join("\n")}`;
}

function selectedLayerSection(req: AiEditRequest, scene: ParsedScene, entrySource: string): string {
  const id = req.layerId ?? "";
  const node = scene.byId[id];
  if (!node) return `# Selected layer\n(layer "${id}" not found)`;
  const source = getLayerSource(entrySource, id);
  return [
    "# Selected layer",
    `${describeLayer(node)} · line ${node.loc.line}`,
    `Ancestors: ${ancestorChain(scene, id)}`,
    "```jsx",
    source,
    "```",
  ].join("\n");
}

/**
 * Content blocks of the final user turn: task + stage, layer overview,
 * line-numbered entry file, other files, selected layer (layer scope), the
 * optional frame screenshot and the instruction. `scene` is null when the
 * entry file does not parse (only acceptable for scope "new").
 */
export function buildUserMessage(req: AiEditRequest, scene: ParsedScene | null): Anthropic.ContentBlockParam[] {
  const entry = req.project.files[req.project.entry];
  const entrySource = entry?.content;
  const sections: string[] = [];

  sections.push(
    [
      "# Task",
      SCOPE_TASK[req.scope],
      `Project: "${req.project.name}" · entry file: ${req.project.entry}`,
      `Stage: ${describeStage(scene?.meta ?? req.project.meta)}`,
    ].join("\n"),
  );

  if (scene && scene.layers.length > 0) {
    sections.push(`# Layers (id "name" <tag> visible range)\n${layerTreeLines(scene).join("\n")}`);
  }

  if (entrySource !== undefined) {
    sections.push(
      `# Entry file \`${req.project.entry}\` (line-numbered; the numbers are not part of the code)\n\`\`\`jsx\n${numberLines(entrySource)}\n\`\`\``,
    );
  } else {
    sections.push(`# Entry file \`${req.project.entry}\`\n(no entry file yet — create it)`);
  }

  sections.push(otherFilesSection(req));

  if (req.scope === "layer" && scene && entrySource !== undefined) {
    sections.push(selectedLayerSection(req, scene, entrySource));
  }

  if (req.frameImage) {
    sections.push("The attached screenshot shows the current frame of the preview.");
  }

  const blocks: Anthropic.ContentBlockParam[] = [{ type: "text", text: sections.join("\n\n") }];
  if (req.frameImage) {
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: req.frameImage.mediaType, data: req.frameImage.data },
    });
  }
  blocks.push({
    type: "text",
    text: `# Instruction\n${req.prompt.trim()}\n\nRespond with the JSON object described in the output format.`,
  });
  return blocks;
}

/**
 * Prior turns (history) followed by the final user turn. Empty turns are
 * dropped and leading assistant turns skipped, because the API requires the
 * first message to come from the user.
 */
export function buildMessages(req: AiEditRequest, scene: ParsedScene | null): Anthropic.MessageParam[] {
  const history: Anthropic.MessageParam[] = [];
  for (const turn of req.history ?? []) {
    const content = turn.content.trim();
    if (!content) continue;
    if (history.length === 0 && turn.role !== "user") continue;
    history.push({ role: turn.role, content });
  }
  return [...history, { role: "user", content: buildUserMessage(req, scene) }];
}

/** The system prompt as a single cached text block (stable prefix). */
export function buildSystem(): Anthropic.TextBlockParam[] {
  return [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }];
}

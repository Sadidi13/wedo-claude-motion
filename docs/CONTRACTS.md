# Motion Studio — module contracts

Motion Studio is a **layer-based editor for Claude Motion / Claude Design animations**.
The animation is code (JSX rendering a `<Stage>` with `<Sprite>` children, a pure function
of time). The editor exposes that code as *layers*, lets the designer add / remove / reorder /
retime layers by hand, and lets Claude rewrite **one selected layer** (or the whole scene)
from a prompt. Export renders frames headlessly (`window.__seek(t)`) and encodes with ffmpeg.

All types referenced here live in `src/lib/types.ts`. Module owners must not change those
types without updating every consumer.

```
src/
  lib/types.ts            shared types (THIS IS THE CONTRACT)
  lib/parser/             §2  JSX  ⇄ layer tree + AST edit operations (pure, isomorphic)
  runtime/                §3  Stage / Sprite / useTime … runtime (client)
  lib/loader/             §3  sucrase compile + mini module system (client)
  app/preview/            §3  iframe page that hosts the runtime (client, also used by export)
  store/                  §4  Zustand store + undo/redo (client)
  components/             §4  editor UI
  lib/ai/                 §5  prompt building + output validation (server + tests)
  app/api/ai/             §5  Claude routes
  lib/server/export/      §6  Playwright + ffmpeg renderer (server)
  app/api/export/         §6  export job routes
  lib/importer/           §7  zip / html / jsx → Project
  samples/                §7  bundled demo project(s)
```

---

## 1. The authoring contract (what the code inside a project must follow)

This mirrors the Claude Motion / Claude Design "Stage" starter so real exports load unchanged.

```jsx
import React from "react";
import { Stage, Sprite, useTime, useSprite, Easing, interpolate, animate } from "./animations.jsx";

export default function Scene() {
  return (
    <Stage width={1280} height={720} duration={8} fps={30} background="#0b0b12">
      <Sprite start={0} end={8} data-layer-id="bg" data-layer-name="Background">
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg,#111,#223)" }} />
      </Sprite>
      <Sprite start={0.5} end={4} data-layer-id="title" data-layer-name="Title">
        {({ progress }) => (
          <h1 style={{ opacity: progress, transform: `translateY(${(1 - Easing.easeOutCubic(progress)) * 40}px)` }}>
            Hello
          </h1>
        )}
      </Sprite>
    </Stage>
  );
}
```

Rules (the AI system prompt and the importer both enforce / assume these):

* Exactly one `<Stage>` in the entry file; its `width`, `height`, `duration`, `fps`, `background`
  props are **numeric / string literals** so the parser can read and edit them.
* Motion is a pure function of time: use `useTime()`, `useSprite()`, `<Sprite start end>`,
  `interpolate()`, `animate()`, `Easing.*`. No CSS `@keyframes` / `transition` / `animation`
  on animated elements, no `Math.random()`, `Date.now()`, `setTimeout`, `requestAnimationFrame`.
* Each **direct child of `<Stage>` is a top-level layer**. Nested JSX elements are sub-layers.
  Every JSX element inside the Stage subtree carries a stable `data-layer-id="…"` (the parser adds
  them if missing). Optional `data-layer-name`, `data-hidden="true"`, `data-locked="true"`.
* `<Sprite start={n} end={n}>` timing props should be numeric literals when the designer is expected
  to retime them from the timeline. Expressions are allowed but shown as read-only.
* Allowed imports inside a project: `react`, `react-dom`, `react-dom/client`, `lucide-react`,
  `three` (three.js, pinned to an exact version in `package.json`; the main module only, no
  `three/addons/…`), `gsap` (pinned) plus `gsap/SplitText`, `gsap/DrawSVGPlugin`,
  `gsap/MorphSVGPlugin`, `gsap/MotionPathPlugin`, `gsap/CustomEase`, `gsap/TextPlugin`
  (`src/lib/gsapModules.ts`; `.js` spellings accepted), the runtime (`./animations.jsx`,
  `./animations`, `@motion/runtime`, `motion-runtime`), and relative project files (`./Card.jsx`,
  `./styles.css`). Anything else fails to load with a clear error.
* Assets are referenced by relative path (`assets/logo.png`); the loader rewrites them to data URLs.

### Runtime API (`src/runtime/motion.tsx`) — exports

| export | signature | notes |
|---|---|---|
| `Stage` | `({ width=1280, height=720, duration=10, fps=30, background, loop=true, autoplay=true, children })` | root. Renders a `position:relative; overflow:hidden` box of exactly width×height, scaled to fit when not embedded. In **embedded mode** (`window.__EMBED === true`, set by the preview page) it does not scale, has no scrubber/keyboard, never autoplays — time only comes from `window.__seek`. In **render mode** (`?__render=1` or `window.__RENDER_MODE`) it is bare, no chrome, hides `[data-export-hide]`. |
| `Sprite` | `({ start=0, end=Infinity, keepMounted=false, children, ...rest })` | visible when `start <= time <= end`; otherwise returns `null` (or stays mounted hidden when `keepMounted`). `children` may be a function `({ localTime, progress, duration, visible }) => node`. **Must spread `...rest` (incl. `data-*` props) onto a wrapper `<div data-sprite style="position:absolute;inset:0">`** so `data-layer-id` lands in the DOM. `data-hidden="true"` ⇒ `display:none`. |
| `useTime()` | `() => number` | current time (seconds). The hooks may be called in the component that renders `<Stage>` (the usual `Scene` shape) as well as anywhere inside it; outside a Stage they read the document clock (time 0 / the defaults above before a Stage mounts) |
| `useTimeline()` | `() => { time, duration, fps, playing, setTime, setPlaying }` | |
| `useSprite()` | `() => { localTime, progress, duration, visible }` | inside a Sprite |
| `useStage()` | `() => StageMeta` | |
| `Easing` | object of `(t:number)=>number` | `linear, easeInQuad, easeOutQuad, easeInOutQuad, easeInCubic, easeOutCubic, easeInOutCubic, easeInQuart, easeOutQuart, easeInOutQuart, easeInExpo, easeOutExpo, easeInOutExpo, easeOutBack, easeInBack, easeInOutBack, easeOutElastic, easeOutBounce` |
| `interpolate(input:number[], output:number[], easing?)` | `(t:number)=>number` | piecewise linear with clamping; `easing` one fn or one per segment |
| `animate({ from, to, start, end, ease? })` | `(t:number)=>number` | single tween, default `Easing.easeInOutCubic` |
| `clamp(v, min, max)`, `lerp(a, b, t)` | helpers | |
| `Three3D` | `({ setup?, render?, width?, height?, camera?, textures?, antialias=true, autoRender=true, style, ...data-* })` | one three.js scene on one WebGL canvas = **one layer** (`src/runtime/three.tsx`). Renders `<div data-three3d style="position:absolute;left:0;top:0;width;height">` (default size: the Stage) carrying the `data-*` props, with the canvas inside. See "3D scenes" below. |
| `useGsapTimeline` | `(build: (tl, scope) => void, deps = []) => RefObject` | one paused GSAP timeline scoped to the element the returned ref is attached to, seeked to the Sprite's local time (stage time outside a Sprite) on every render (`src/runtime/gsap.tsx`). See "GSAP" below. |

Globals the runtime installs on `window` when a Stage mounts:
`__videoMeta = { width, height, duration, fps }`, `__seek(t)`, `__ready = true`,
`__getLayerRects(): LayerRect[]` (bounding boxes of every `[data-layer-id]` in stage coordinates),
`__setTransparent(bool)` (toggles the Stage background off for alpha export),
`__whenIdle(): Promise<void>` (resolves once work the current frame waits for — web fonts before a
`<Three3D>` setup or a `useGsapTimeline` build, `<Three3D>` textures — is drawn; `src/runtime/pending.ts`).

### 3D scenes (`<Three3D>`)

A 3D scene is still a pure function of time. `<Three3D>` owns a `WebGLRenderer` (`alpha: true`,
`preserveDrawingBuffer: true`), a `Scene` and a `PerspectiveCamera` (`camera={{ fov, near, far }}`,
default 45 / 0.1 / 1000) and never runs a loop:

1. **setup** — once per mount, after web fonts are ready and `textures` (`{ name: url }`, project
   assets become data URLs) are decoded: `setup({ THREE, scene, camera, renderer, width, height,
   textures })` builds meshes, lights and materials and returns whatever `render` needs (`state`).
2. **render** — after every commit, i.e. every time change, in a layout effect (so under `__seek`'s
   `flushSync` the canvas is drawn before `__seek` returns): `render(t, { …ctx, state, time,
   localTime, progress })`, then `renderer.render(scene, camera)` unless `autoRender={false}`. It sets
   every moving property to an absolute value computed from `t`, never `+=`, because frames are
   rendered out of order and by several workers.
3. **unmount** — geometries, materials, textures and the renderer are disposed and the WebGL context
   is released. A lost context or a WebGL-less browser throws into the Stage's error boundary
   (reported as a preview `error`, and an export failure instead of blank frames).

No `renderer.setAnimationLoop`, `requestAnimationFrame`, `THREE.Clock`, `performance.now()` or
`Math.random()` (use `THREE.MathUtils.seededRandom(seed)`); animation clips use `mixer.setTime(t)`;
images come through `textures`, not loaders. The canvas is transparent where nothing is drawn; text and
titles are ordinary 2D layers above it. Example (a camera dolly through lit boxes, then a title lands):

```jsx
import React from "react";
import * as THREE from "three";
import { Stage, Sprite, Three3D, interpolate, Easing } from "./animations.jsx";

const dolly = interpolate([0, 5], [14, 3], Easing.easeInOutCubic);

export default function Scene() {
  return (
    <Stage width={1080} height={1920} duration={6} fps={30} background="#07080d">
      <Sprite start={0} end={6} data-layer-name="3D boxes">
        <Three3D
          setup={({ scene }) => {
            scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x10131c, 0.8));
            const key = new THREE.DirectionalLight(0xffffff, 2.4);
            key.position.set(4, 6, 5);
            scene.add(key);
            const boxes = Array.from({ length: 12 }, (_, i) => {
              const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xff5a36 }));
              box.position.set(i % 2 ? 1.8 : -1.8, (i % 3) - 1, 2 - i * 1.4);
              scene.add(box);
              return box;
            });
            return { boxes };
          }}
          render={(t, { camera, state }) => {
            camera.position.set(0, 0.4, dolly(t));
            camera.lookAt(0, 0, -20);
            state.boxes.forEach((box, i) => box.rotation.set(t * 0.4 + i, t * 0.6, 0));
          }}
        />
      </Sprite>
      <Sprite start={3.6} end={6} data-layer-name="Title">
        {({ progress }) => <h1 style={{ position: "absolute", left: 80, bottom: 360, opacity: progress }}>Into the depth</h1>}
      </Sprite>
    </Stage>
  );
}
```

The bundled sample `dolly-3d` (`src/samples/dolly3d.ts`) is the fuller version: fog, an emissive
accent, a text sign drawn on an `OffscreenCanvas` texture, and 2D title / vignette layers.

### GSAP (`useGsapTimeline`)

GSAP runs on Motion Studio's time, never its own. Importing the runtime pauses
`gsap.globalTimeline` (a tween made outside the hook never moves) and registers the plugins listed
above, so scenes need not call `gsap.registerPlugin`. In a component inside a `<Sprite>`:

```jsx
const ref = useGsapTimeline((tl, scope) => { tl.from(".word", { yPercent: 100, stagger: 0.06 }); }, [deps]);
return <div ref={ref}>…</div>;
```

* `build` runs once per mount (again when `deps` change), after web fonts are ready (SplitText
  measures text; the frame is held meanwhile), inside a `gsap.context` scoped to the ref'd element,
  on a timeline created with `paused: true`.
* Every render — every time change — seeks it, in a layout effect, to the Sprite's `localTime`
  (time 0 = the Sprite's `start`; the stage time outside a Sprite). `seek()` renders synchronously,
  so under `__seek`'s `flushSync` the styles are written before `__seek` returns; backwards and
  out-of-order seeks give the same styles (`src/runtime/__tests__/gsap.test.tsx`). Callbacks do not
  fire (seeks suppress events).
* Unmount or a `deps` change reverts the context: inline styles and SplitText markup go back to what
  React rendered. Properties GSAP animates stay out of that element's React `style` prop.
* No randomness: `"random(…)"` values, `stagger: { from: "random" }` and `gsap.utils.random` are
  rejected by the AI validator (each export worker would draw different values).
* Timeline UI: the Sprite's start / end stay draggable and move the whole GSAP animation; GSAP
  durations, delays and staggers live in code and are not editable on the timeline.

Example (SplitText kinetic typography inside a Sprite):

```jsx
import React from "react";
import { SplitText } from "gsap/SplitText";
import { Stage, Sprite, useGsapTimeline } from "./animations.jsx";

function Headline() {
  const ref = useGsapTimeline((tl) => {
    const split = SplitText.create(".headline", { type: "chars,words", mask: "chars" });
    tl.from(split.chars, { yPercent: 110, rotate: 6, duration: 0.7, ease: "power4.out", stagger: 0.035 });
  });
  return (
    <div ref={ref} style={{ position: "absolute", left: 90, right: 90, top: 760 }}>
      <h1 className="headline" style={{ margin: 0, color: "#fff", font: "800 140px/1 system-ui" }}>Make it move</h1>
    </div>
  );
}

export default function Scene() {
  return (
    <Stage width={1080} height={1920} duration={4} fps={30} background="#0b0b12">
      <Sprite start={0.3} end={4} data-layer-name="Headline"><Headline /></Sprite>
    </Stage>
  );
}
```

The bundled sample `kinetic-type` (`src/samples/kineticType.ts`) adds a TextPlugin kicker, a DrawSVG
stroke and a word-by-word subtitle. GSAP is not MIT-licensed: it ships under GreenSock / Webflow's
"Standard No Charge" license (gsap.com/community/standard-license).

Plain-HTML projects (no `<Stage>`): the loader wraps the rendered root in a Stage using the
project's `meta` so everything above still works.

---

## 2. Parser (`src/lib/parser`) — pure functions, `string → string`

Isomorphic (runs in browser and on the server). Babel 8 (`@babel/parser`, `@babel/traverse`,
`@babel/generator`, `@babel/types`). **All edits must be minimal and preserve the untouched
source byte-for-byte** (prefer splicing by `node.start/end` offsets over regenerating the whole
file with `@babel/generator`; generator is acceptable only for the fragment being inserted).

```ts
export function parseScene(source: string): ParsedScene;            // throws ParseError with {message, line, column}
export function ensureLayerIds(source: string): { source: string; changed: boolean }; // add missing data-layer-id to every JSX element inside <Stage>; ids = nanoid(8)-style, lowercase alnum, prefixed by tag e.g. "sprite-k3f9x2"
export function getLayerSource(source: string, id: string): string;  // exact JSX text of that element
export function replaceLayerSource(source: string, id: string, jsx: string): string; // jsx must parse to exactly one JSX element; its data-layer-id is forced to `id`; nested elements without ids get ids
export function deleteLayer(source: string, id: string): string;
export function duplicateLayer(source: string, id: string): { source: string; newId: string }; // inserted right after the original; all ids in the copy are regenerated; name gets " copy"
export function moveLayer(source: string, id: string, move: { direction: "up" | "down" } | { parentId: string | null; index: number }): string; // parentId null = Stage
export function setLayerTiming(source: string, id: string, timing: { start?: number; end?: number }): string; // Sprite only (throws otherwise); writes numeric literals
export function wrapInSprite(source: string, id: string, start: number, end: number): { source: string; spriteId: string }; // wrap any non-Sprite layer
export function setLayerHidden(source: string, id: string, hidden: boolean): string;
export function setLayerLocked(source: string, id: string, locked: boolean): string;
export function setLayerName(source: string, id: string, name: string): string;
export function insertLayer(source: string, parentId: string | null, jsx: string, index?: number): { source: string; id: string }; // index undefined = append
export function setStageMeta(source: string, meta: Partial<StageMeta>): string;
export function listLayerIds(source: string): string[];
```

Layer naming rule (`LayerNode.name`): `data-layer-name` > for text elements the first 24 chars of text
> `<Tag>`; Sprite with a single element child may borrow that child's text for the preview.
`LayerNode.kind`: `Sprite` ⇒ `sprite`; `img|Image|video` ⇒ `image`; `svg|path|circle|rect|...` ⇒ `shape`;
`Three3D|canvas` ⇒ `canvas` (one drawn layer: the meshes inside a 3D scene are not layers, and JSX in
its `setup` / `render` props is a prop value, not a sub-layer); capitalised tag ⇒ `component`; element whose children are only text/expressions ⇒ `text`;
element with element children ⇒ `group`; else `element`.
`range` = intersection of own Sprite timing with the nearest ancestor Sprite range; non-Sprite
elements inherit the parent range; root default is `[0, meta.duration]`.

Also exported: `class ParseError extends Error { line?: number; column?: number }`.

Unit tests (vitest) must cover: ids added once and stable; replace preserves id; delete/duplicate/move;
timing edit keeps formatting; setStageMeta; nested Sprite ranges; error on bad JSX.

---

## 3. Preview page + loader (`src/app/preview`, `src/lib/loader`, `src/runtime`)

`/preview` is a client-only Next page rendered inside an `<iframe>` by the editor **and** opened by
the export renderer in headless Chromium. Query params:

* `?job=<id>` — fetch the project from `GET /api/export/<id>/project` and load it (export path).
* `?__render=1` — render mode (bare canvas at the origin, no scaling, `window.__RENDER_MODE = true`).
* `?transparent=1` — stage background removed (alpha export).
* no params — embedded mode: waits for a `load` postMessage from the parent (`window.__EMBED = true`).

Loader (`src/lib/loader/index.ts`):

```ts
export interface LoadResult { meta: StageMeta; unmount: () => void }
export async function loadProject(project: Project, mount: HTMLElement, opts?: { transparent?: boolean }): Promise<LoadResult>;
export function compileFile(path: string, source: string): string;  // sucrase: jsx + typescript + imports → CommonJS (classic runtime, React global)
export class LoadError extends Error { file?: string }
```

Module resolution inside `loadProject`: `react` → the page's React; `react-dom`, `react-dom/client` → a
shim whose `createRoot(el).render(node)` / `render(node, el)` renders `node` into the mount (so
Claude's `ReactDOM.createRoot(document.getElementById('root')).render(<App/>)` just works);
`lucide-react` → real package; `three` → the pinned three.js (the same instance `<Three3D>` uses);
`gsap`, `gsap/<Plugin>` → the modules `src/runtime/gsap.tsx` imports and configures (`GSAP_NAMESPACES`);
runtime aliases (see §1) → `src/runtime` (`motion.tsx`, `three.tsx`, `useGsapTimeline`); relative paths →
other project files (`.jsx/.js/.tsx/.ts` compiled, `.css` injected as `<style data-file=…>`,
assets → their data URL string); anything else → `LoadError("Unsupported import 'x' in file y")`.
The entry file's default export (a component) is rendered; if there is no default export but
`ReactDOM.render/createRoot(...).render` was called, that element is used; else `LoadError`.
Entry files that are HTML (`kind: "html"`) are handled by the importer (§7) before they reach the loader.

postMessage protocol (types in `types.ts`):

| direction | message | behaviour |
|---|---|---|
| editor→preview | `{type:"load", project, time?}` | (re)load; reply `ready` with meta, or `error` |
| editor→preview | `{type:"seek", time}` | `window.__seek(time)` |
| editor→preview | `{type:"getLayerRects"}` | reply `layerRects` (stage coordinates) |
| editor→preview | `{type:"highlight", id}` | draw a 1px outline on that layer (preview-side overlay, not in export) |
| editor→preview | `{type:"setTransparent", transparent}` | toggle background |
| preview→editor | `{type:"select", id}` | user clicked inside the canvas: deepest `[data-layer-id]` under pointer (`null` for empty area) |
| preview→editor | `{type:"ready"|"layerRects"|"error"|"warning"}` | as above |

Runtime errors thrown while rendering (React error boundary) are posted as `error` and shown in
the editor; the previous good frame stays visible.

---

## 4. Editor store (`src/store/editorStore.ts`) and UI

Zustand store. The **entry file source string** is the single mutable truth; `scene: ParsedScene`
is re-derived with `parseScene` on every change. Undo/redo = stack of source snapshots (max 200).

```ts
interface EditorState {
  project: Project | null;
  scene: ParsedScene | null;      // derived
  parseError: string | null;
  selectedId: string | null;
  time: number; playing: boolean; loop: boolean;
  previewError: string | null;
  layerRects: LayerRect[];
  history: { past: string[]; future: string[] };
  // actions
  loadProject(p: Project): void;
  newBlankProject(meta?: Partial<StageMeta>): void;
  setSource(next: string, opts?: { recordHistory?: boolean }): void; // runs ensureLayerIds + parseScene, bumps updatedAt, autosaves
  select(id: string | null): void;
  seek(t: number): void; play(): void; pause(): void; toggleLoop(): void;
  // layer ops (thin wrappers over parser, each records history)
  deleteLayer(id); duplicateLayer(id); moveLayer(id, move); setTiming(id, {start,end});
  setHidden(id, hidden); setLocked(id, locked); renameLayer(id, name); wrapInSprite(id, start, end);
  insertLayer(parentId, jsx, index?); replaceLayer(id, jsx); setStageMeta(partial);
  addTextLayer(); addImageLayer(file); addShapeLayer(kind); // built-in templates inserted at the playhead, 2s long
  undo(); redo();
  updateFile(path, content); addFile(file); removeFile(path);
}
```

Autosave: `localStorage["motion-studio:project:<id>"]` (debounced 500ms) +
`localStorage["motion-studio:last"]` = id. On first visit with nothing saved, the bundled sample
project is loaded.

UI layout (`src/app/page.tsx` → `components/Editor.tsx`): top bar · left Layers panel · centre Canvas
(iframe `/preview`, fit-to-view, selection outline from `layerRects`) · right Inspector with tabs
**Properties** (name, timing, hidden/locked, stage meta when nothing selected), **Code** (editable
source of the selected layer with Apply), **Ask Claude** (prompt, scope toggle layer/scene, history,
Apply/Undo) · bottom Timeline (ruler, playhead, one track per layer in tree order with expand/collapse,
clip bars draggable to move and trim, snapping to frames, play/pause, loop, time readout, zoom).
Keyboard: Space play/pause, ←/→ frame step, Shift+←/→ 1s, Delete removes selected layer,
Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z undo/redo, Ctrl/Cmd+D duplicate, H toggle hidden.
Dark UI, English labels, Tailwind v4, lucide-react icons. Must look like a real tool, not a demo.

---

## 5. AI routes (`src/app/api/ai/edit/route.ts`, `src/lib/ai`)

`POST /api/ai/edit` — body `AiEditRequest`, response `AiEditResponse | AiErrorResponse`.

* Anthropic TypeScript SDK (`@anthropic-ai/sdk`), model from `MOTION_STUDIO_MODEL` (default
  `claude-opus-5-5`), adaptive thinking (default — do not send `thinking`), `output_config.effort`
  `"high"` for scene/new, `"medium"` for layer. Structured output via `client.messages.parse` +
  `zodOutputFormat` with schema `{ summary: string, code: string, files?: {path, content}[] }`.
  Follow the bundled skill docs at
  `/tmp/claude-0/bundled-skills/2.1.308/ebb8ec9b9e5cca46c2dd31ddbe607915/claude-api/typescript/claude-api/{README,tool-use,streaming}.md`
  and verify every SDK symbol against `node_modules/@anthropic-ai/sdk` before use.
* System prompt (`src/lib/ai/prompts.ts`): the authoring contract (§1) incl. the runtime API table,
  the allowed-imports rule, "preserve `data-layer-id` attributes", "return only the element / file
  requested", design-quality guidance (easing, stagger, hierarchy, safe margins, readable type),
  and "reply `summary` in the same language as the prompt (Persian or English)".
  Put the stable contract text first with `cache_control: {type: "ephemeral"}`; volatile project
  content goes in the user turn.
* User turn: stage meta, the full entry source (with line numbers), other project file names,
  for `layer` scope the exact `getLayerSource(id)` plus its ancestors' tags/timing, the prompt,
  optional `frameImage` as an image block, and `history` as prior turns.
* Validation (`src/lib/ai/validate.ts`): for `layer` scope run `replaceLayerSource` on a copy and
  `parseScene` the result; for `scene|new` run `ensureLayerIds` + `parseScene`; also reject
  disallowed imports. On failure, retry **once** by appending the validation error as a new user
  turn; then return `{ok:false, code:"invalid_output"}`.
* Handle `stop_reason === "refusal"` → `{ok:false, code:"refusal"}`, missing key →
  `{ok:false, code:"missing_api_key", error:"Set ANTHROPIC_API_KEY in .env.local"}`, SDK errors
  by class (`Anthropic.AuthenticationError`, `RateLimitError`, `APIConnectionError`, `APIError`).
* `GET /api/ai/status` → `{ configured: boolean, model: string }`.
* Unit tests with a mocked client (inject via `createAiService({ client })`).

---

## 6. Export (`src/lib/server/export`, `src/app/api/export`)

* `POST /api/export` body `ExportRequest` → `{ jobId }` (202). Job dir:
  `os.tmpdir()/motion-studio/jobs/<jobId>/` with `project.json`, `status.json`, `frames/`, output file.
* `GET /api/export/[jobId]` → `ExportJobStatus` (reads `status.json`).
* `GET /api/export/[jobId]/project` → the project JSON (used by `/preview?job=`).
* `GET /api/export/[jobId]/download` → the file (`Content-Disposition: attachment`).
* Renderer (`renderJob(jobId, origin)`): `playwright-core` `chromium.launch({ executablePath:
  process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox","--force-color-profile=srgb"] })`;
  new context `viewport = {width, height}` of the stage, `deviceScaleFactor = scale`; goto
  `${origin}/preview?job=<id>&__render=1[&transparent=1]`; wait for `window.__ready === true &&
  typeof window.__seek === "function"`; `document.fonts.ready` + 300ms; for each frame `i` in range:
  `await page.evaluate(t => new Promise(r => { window.__seek(t); (window.__whenIdle?.() ??
  Promise.resolve()).then(() => requestAnimationFrame(() => requestAnimationFrame(r))) }), i/fps)`,
  then `page.screenshot({ clip, type: transparent ? "png" : "jpeg", quality: 95, omitBackground:
  transparent })` → `frames/f_%06d.(png|jpg)`. Update `status.json` every 10 frames. Parallel
  contexts (default 3) each render a contiguous range.
* WebGL (`projectUsesWebGL`: a `three` import, `<Three3D>` or a WebGL `getContext`): Chromium also
  gets `--enable-unsafe-swiftshader`. Headless Chrome draws WebGL on the machine's GPU when it has one
  (Windows: ANGLE / Direct3D 11) and needs that switch to fall back to SwiftShader on machines without
  one. `MOTION_STUDIO_WEBGL=swiftshader` forces the software rasteriser (`--use-angle=swiftshader`):
  slower, the same pixels on every machine. The sandbox stays on. Frames come out identical whatever
  the worker split (`webgl.integration.test.ts`).
* ffmpeg (`FFMPEG_PATH` or `ffmpeg`): mp4 `-c:v libx264 -preset slow -crf <q> -pix_fmt yuv420p
  -movflags +faststart`; webm `-c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 24` (alpha);
  mov `-c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le` (alpha); gif two-pass palettegen/
  paletteuse; png-sequence → zip. Always `-r <fps>` and `-framerate <fps>` input.
  Scale filter only when `scale === 2` is **not** requested as the output size (we export at the
  supersampled size by default; option `downscale` is not part of v1).
* Errors land in `status.json` as `state:"error"`. Browser and ffmpeg are always closed/killed in `finally`.
* The origin passed to the renderer is derived from the incoming request (`request.nextUrl.origin`).

---

## 7. Importer (`src/lib/importer`) + samples

```ts
export async function importFromZip(file: ArrayBuffer | Blob, opts?: { name?: string }): Promise<Project>;   // Claude Design "Project archive": artifact.html|index.html + manifest.json + assets/
export function importFromHtml(html: string, opts?: { name?: string }): Project;   // standalone HTML export / pasted HTML
export function importFromJsx(source: string, opts?: { name?: string }): Project;  // raw scene.jsx (Stage-based)
export function exportProjectZip(project: Project): Promise<Blob>;                  // round-trip: files + assets + manifest.json
export function createBlankProject(meta?: Partial<StageMeta>, name?: string): Project;
```

HTML handling: collect `<script type="text/babel|text/jsx|module">` bodies (inline) in order →
`scene.jsx`; strip CDN `<script src>` tags for React/Babel (we provide them) but **keep** Google
Fonts `<link>`s and inline `<style>` → `styles.css` (imported by `scene.jsx`); `<img src="assets/…">`
and CSS `url(assets/…)` are left as relative paths (the loader rewrites them). If the HTML has no
`<Stage>`, wrap the root render in a `<Stage>` using width/height from `window.__videoMeta`,
`<meta name="hz:canvas-width">`-style hints, or default 1920×1080, duration 10s, fps 30 — and add
`origin: "html"` + a warning. Run `ensureLayerIds` on the entry at the end of every import.

Samples (`src/samples/index.ts`): `export const samples: { id, name, description, project }[]`.
Ship at least **`product-launch`** (1280×720, 8s, 30fps): gradient background, animated title +
subtitle, three staggered feature cards with lucide icons, a growing bar chart (4 bars) with value
labels, logo/CTA outro — every top-level element a named `<Sprite>` so the layers panel looks great.
Written exactly in the §1 style so it doubles as the reference the AI prompt links to. Also shipped:
`lower-third` (alpha overlay), `dolly-3d` (1080×1920, a `<Three3D>` layer under 2D titles) and
`kinetic-type` (1080×1920, GSAP SplitText / DrawSVG / TextPlugin through `useGsapTimeline`).

---

## 8. Quality bar

* `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all pass.
* No `any` without a comment; no unused exports in a module's public index.
* Every module has a short README-style header comment explaining its role.

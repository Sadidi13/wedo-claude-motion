# Motion Studio

Layer-based editor for **Claude Motion / Claude Design** animations.

Claude Motion writes animations as code (a `<Stage>` with `<Sprite>` children, a pure function of
time) but exports a flat MP4. Motion Studio imports that code instead, shows every element as an
editable **layer** (layers panel + timeline), lets you add / delete / retime / reorder / hide layers
by hand, and lets Claude rewrite **just the layer you selected** from a prompt. Export renders
frames headlessly in Chromium and encodes MP4 / WebM (alpha) / MOV ProRes 4444 (alpha) / GIF /
PNG sequence.

Persian product proposal: `docs/PROPOSAL.fa.md`. Module contracts: `docs/CONTRACTS.md`.

## Quick start

```bash
pnpm install
cp .env.example .env.local        # add ANTHROPIC_API_KEY for the "Ask Claude" panel
pnpm dev                           # http://localhost:3000
```

The editor opens with the bundled **Product launch** sample. Use **Import** to load your own
animation, **Export** to render a video, **Save** to download the project as a `.zip`.

Requirements: Node 22+ and pnpm. Export uses the installed Chrome / Edge / Chromium (auto-detected on
Windows, macOS and Linux; `CHROMIUM_PATH` to override) and the ffmpeg binary bundled by `ffmpeg-static`
(`FFMPEG_PATH` to override).

## Getting the code out of Claude

| Where the animation lives | What to export | How Motion Studio reads it |
|---|---|---|
| Claude Design | Share → Export → **Project archive (.zip)** (`artifact.html` + `manifest.json` + `assets/`) | Import → drop the zip |
| Claude Design | Share → Export → **Standalone HTML** | Import → drop the `.html` |
| Claude Motion (chat) | Ask Claude: *"give me the full HTML / JSX of this animation"* and save it | Import → drop the `.html` / `.jsx` |
| No Claude Motion access | Ask Claude panel → scope **New scene** → describe the animation | generated inside the app with your API key |

MP4 files cannot be turned back into layers.

## How it works

```
Import (zip / html / jsx) ──► Project { files, entry: scene.jsx, meta }
                                  │
                   Parser (Babel 8): JSX ⇄ layer tree, stable data-layer-id per element
                                  │
   Layers panel ── Timeline (Sprite bars) ── Inspector (Properties / Code / Ask Claude)
                                  │  postMessage {load, seek, select, layerRects}
                       Preview iframe  /preview  (Stage/Sprite runtime + sucrase)
                                  │
   Ask Claude ──► POST /api/ai/edit  → Claude Opus 5.5, structured output {summary, code}
                  validate (parse + same id) → replace only that element → undo-able
   Export ─────► POST /api/export   → headless Chromium opens /preview?job=…&__render=1,
                  window.__seek(t) per frame → ffmpeg
```

The entry file's source code is the single source of truth; every UI action is a small,
byte-precise edit of that text (so a Claude-written scene survives round trips unchanged).

## Authoring contract (what imported code must follow)

```jsx
import React from "react";
import { Stage, Sprite, useTime, useSprite, Easing, interpolate, animate } from "./animations.jsx";

export default function Scene() {
  return (
    <Stage width={1280} height={720} duration={8} fps={30} background="#0b0b12">
      <Sprite start={0.5} end={4} data-layer-name="Title">
        {({ progress }) => <h1 style={{ opacity: progress }}>Hello</h1>}
      </Sprite>
    </Stage>
  );
}
```

* Motion is a pure function of time (`useTime`, `useSprite`, `interpolate`, `animate`, `Easing`);
  no CSS transitions/keyframes, timers or randomness.
* Allowed imports: `react`, `react-dom`, `lucide-react`, the runtime (`./animations.jsx`) and
  relative project files (`.jsx`, `.css`, assets).
* Every element inside the Stage gets a stable `data-layer-id` (added automatically).

## Environment variables

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | required for Ask Claude (server side only) |
| `MOTION_STUDIO_MODEL` | model id, default `claude-opus-5-5` |
| `CHROMIUM_PATH` | browser binary for export (auto-detected when empty) |
| `FFMPEG_PATH` | ffmpeg binary (bundled `ffmpeg-static` when empty) |
| `MOTION_STUDIO_JOBS_DIR` | where export jobs are written, default `$TMPDIR/motion-studio/jobs` |

## Scripts

```bash
pnpm dev        # dev server
pnpm build      # production build
pnpm start      # serve the build
pnpm test       # vitest (parser, loader, importer, samples, store, AI service, export)
pnpm typecheck  # tsc --noEmit
pnpm lint       # eslint
```

## Keyboard

Space play/pause · ←/→ frame step · Shift+←/→ 1 s · Delete remove layer · Ctrl/Cmd+Z / Shift+Z
undo/redo · Ctrl/Cmd+D duplicate · H toggle hidden · Ctrl+wheel zoom timeline.

## Roadmap

1. On-canvas drag/resize that writes values back into the code.
2. Frame screenshot as visual context for Ask Claude; Persian fonts bundled for export; audio track.
3. Keyframe inspector over `interpolate()` curves.
4. Windows app (Tauri) with bundled Chromium + ffmpeg.
5. Bridges: After Effects (Higgsfield Bridge), Lottie for simple SVG layers, Figma motion context.

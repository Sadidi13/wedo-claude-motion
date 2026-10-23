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
cp .env.example .env.local        # optional: ANTHROPIC_API_KEY, only if you do not use Claude Desktop
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

## Working from Claude Desktop (no API key)

A Claude subscription can drive the editor through the Claude desktop app (Code tab) or Claude Code,
with no API key. Open this repository (or its parent folder) in a Claude session while `pnpm dev` runs:

- **Chat to editor.** "Make a 6 s teaser for …" creates a layered scene that opens in the editor.
  "Make the title bigger" edits the open project as one undo-able step.
- **Editor to chat.** Say "listen to Motion Studio" in the chat once. From then on, the Ask Claude tab
  sends its requests to that session, and the answers are applied in the editor.

Claude follows the `motion-studio` skill (`.claude/skills/motion-studio/SKILL.md`) and drives
`scripts/motion-bridge.mjs`. Answers pass the same validation as API replies. Design and routes:
`docs/CLAUDE-DESKTOP.md`.

The regular Claude chat in Claude Desktop works too, through an MCP connector. On Windows,
double-click `scripts/connect-claude-chat.cmd` once and quit Claude when it asks; elsewhere, quit Claude
Desktop and run `node scripts/motion-bridge.mjs install-chat`. Then ask the chat for a video, or say
"listen to Motion Studio" / "check Motion Studio" to answer requests from the editor.

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
| `ANTHROPIC_API_KEY` | optional: Ask Claude through the API instead of Claude Desktop (server side only) |
| `MOTION_STUDIO_MODEL` | model id, default `claude-opus-5-5` |
| `CHROMIUM_PATH` | browser binary for export (auto-detected when empty) |
| `FFMPEG_PATH` | ffmpeg binary (bundled `ffmpeg-static` when empty) |
| `MOTION_STUDIO_JOBS_DIR` | where export jobs are written, default `$TMPDIR/motion-studio/jobs` |
| `MOTION_STUDIO_BRIDGE_DIR` | Claude Desktop bridge state, default `.motion-bridge/state` in the repo |

## Scripts

```bash
pnpm dev        # dev server
pnpm build      # production build
pnpm start      # serve the build
pnpm test       # vitest (parser, loader, importer, samples, store, AI service, export)
pnpm typecheck  # tsc --noEmit
pnpm lint       # eslint
pnpm bridge     # Claude Desktop bridge CLI (status | contract | project | wait | respond | fail | new | edit)
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

# WeDo Claude Motion for developers

User-facing install and usage are in [`README.md`](../README.md) and [`INSTALL.md`](../INSTALL.md).
This page covers how the editor works and how to run it from source. The editor is called Motion
Studio in the code.

Module contracts: [`CONTRACTS.md`](CONTRACTS.md). Claude integrations (bridge, MCP connector,
autopilot): [`CLAUDE-DESKTOP.md`](CLAUDE-DESKTOP.md). Threat model: [`../SECURITY.md`](../SECURITY.md).

## What it does

Claude Motion writes animations as code: a `<Stage>` with `<Sprite>` children, a pure function of
time. It exports a flat MP4. WeDo Claude Motion imports the code instead and then

- shows every element as an editable **layer** (layers panel and timeline);
- lets you add, delete, retime, reorder and hide layers by hand;
- lets Claude rewrite **just the selected layer** from a prompt.

Export renders frames headlessly in Chromium and encodes MP4, WebM (alpha), MOV ProRes 4444 (alpha),
GIF or a PNG sequence.

## Run from source

Requirements: Node 22+, pnpm, and Chrome / Edge / Chromium for export.

```bash
git clone https://github.com/Sadidi13/wedo-claude-motion.git
cd wedo-claude-motion
pnpm install
pnpm dev                           # http://localhost:3000
```

- **Browser for export:** auto-detected on Windows, macOS and Linux. Set `CHROMIUM_PATH` to override it.
- **ffmpeg:** the binary bundled by `ffmpeg-static`. Set `FFMPEG_PATH` to override it.
- **`.env.local`:** optional (`cp .env.example .env.local`). It is only needed for `ANTHROPIC_API_KEY`,
  if the Ask Claude tab should use the Anthropic API instead of a Claude subscription.

## Getting the code out of Claude

| Where the animation lives | What to export | How the editor reads it |
|---|---|---|
| Claude Design | Share → Export → **Project archive (.zip)** (`artifact.html` + `manifest.json` + `assets/`) | Import → drop the zip |
| Claude Design | Share → Export → **Standalone HTML** | Import → drop the `.html` |
| Claude Motion (chat) | Ask Claude: *"give me the full HTML / JSX of this animation"* and save it | Import → drop the `.html` / `.jsx` |
| No Claude Motion access | Ask Claude in the chat or the Code tab, or Ask Claude panel → scope **New scene** | generated straight into the editor |

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
   Ask Claude ──► Claude Desktop bridge (subscription) or POST /api/ai/edit (API key)
                  validate (parse + same id) → replace only that element → undo-able
   Export ─────► POST /api/export   → headless Chromium opens /preview?job=…&__render=1,
                  window.__seek(t) per frame → ffmpeg
```

The entry file's source code is the single source of truth. Every UI action is a small,
byte-precise edit of that text, so a Claude-written scene survives round trips unchanged.

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

* Motion is a pure function of time (`useTime`, `useSprite`, `interpolate`, `animate`, `Easing`).
  No CSS transitions/keyframes, timers or randomness.
* Allowed imports: `react`, `react-dom`, `lucide-react`, `three` (pinned; main module only), `gsap`
  (pinned) with the plugins in `src/lib/gsapModules.ts`, the runtime (`./animations.jsx`) and
  relative project files (`.jsx`, `.css`, assets).
* 3D: the runtime's `<Three3D setup render>` draws a three.js scene as one layer, still a pure
  function of time (`docs/CONTRACTS.md` §1 "3D scenes", sample `dolly-3d`).
* GSAP: `useGsapTimeline(build, deps)` builds a paused timeline that the runtime seeks to the
  Sprite's local time (`docs/CONTRACTS.md` §1 "GSAP", sample `kinetic-type`). GSAP itself is not
  MIT: it is under GreenSock / Webflow's "Standard No Charge" license.
* Every element inside the Stage gets a stable `data-layer-id` (added automatically).

## Environment variables

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | optional: Ask Claude through the API instead of Claude Desktop (server side only) |
| `MOTION_STUDIO_MODEL` | model id for the API path, default `claude-opus-5-5` |
| `CHROMIUM_PATH` | browser binary for export (auto-detected when empty) |
| `FFMPEG_PATH` | ffmpeg binary (bundled `ffmpeg-static` when empty) |
| `MOTION_STUDIO_JOBS_DIR` | where export jobs are written, default `$TMPDIR/motion-studio/jobs` |
| `MOTION_STUDIO_WEBGL` | `swiftshader` renders 3D exports with Chrome's software rasteriser (same pixels everywhere, slower); default uses the GPU |
| `MOTION_STUDIO_BRIDGE_DIR` | Claude Desktop bridge state, default `.motion-bridge/state` in the repo |
| `MOTION_STUDIO_AUTOPILOT_MODEL` | model for the autopilot (`sonnet` uses less of your plan than the default) |
| `MOTION_STUDIO_CLAUDE_BIN` | Claude Code binary for the autopilot when `claude` is not on PATH |
| `MOTION_STUDIO_ALLOWED_HOSTS` | extra host names the server answers to (default: localhost only) |
| `MOTION_STUDIO_CHROMIUM_NO_SANDBOX` | `1` turns Chromium's sandbox off for export (only for containers that need it) |
| `MOTION_STUDIO_ALLOW_REMOTE` | `1` lets the CLI send the bridge token to a non-local http server (not recommended) |

Installer options (Windows, `scripts/install-windows.ps1`): `WEDO_INSTALL_DIR`, `WEDO_NO_SHORTCUTS=1`,
`WEDO_NO_CONNECT=1`, `WEDO_NO_START=1`.

## Scripts

```bash
pnpm dev        # dev server (127.0.0.1)
pnpm build      # production build
pnpm start      # serve the build
pnpm test       # vitest (parser, loader, importer, samples, store, AI service, bridge, export)
pnpm typecheck  # next typegen + tsc --noEmit
pnpm lint       # eslint
pnpm bridge     # bridge CLI: start | open | status | contract | project | wait | respond | fail | new | edit | install-chat
pnpm autopilot  # answer the Ask Claude tab automatically with Claude Code
```

Windows double-click helpers in `scripts/`:

| Script | What it does |
|---|---|
| `start.cmd` | starts the server in a minimised window and opens the editor |
| `start-autopilot.cmd` | starts the server if needed, signs Claude Code in the first time, runs the autopilot |
| `connect-claude-chat.cmd` | waits for Claude Desktop to quit, registers the MCP connector, opens Claude again |
| `install-windows.ps1` | the one-line installer |

## Security

The editor is a local tool, so the server is locked to this machine:

- It listens on 127.0.0.1 and answers only to `localhost` host names (no LAN access, no DNS rebinding).
- `/api` refuses requests from other web sites, non-JSON writes and bodies over 64 MB.
- Routes that act for Claude need a random token stored in the repository's `.motion-bridge/state`.
- Claude's answers are validated before the editor applies them. The autopilot runs Claude Code
  with no tools, no MCP servers and no settings, in an empty temporary folder.
- Export runs Chromium with its sandbox on and blocks the rendered scene from calling the app's API.
  Stage size, duration, frame count and concurrent exports are capped.

**Imported projects run code.** A project is JavaScript that runs inside the editor, like opening an
HTML file. See [`SECURITY.md`](../SECURITY.md) for the full threat model.

## Roadmap

1. On-canvas drag/resize that writes values back into the code.
2. Frame screenshot as visual context for Ask Claude; Persian fonts bundled for export; audio track.
3. Keyframe inspector over `interpolate()` curves.
4. Windows app (Tauri) with bundled Chromium + ffmpeg, and a one-click Claude Desktop extension.
5. Bridges: After Effects (Higgsfield Bridge), Lottie for simple SVG layers, Figma motion context.

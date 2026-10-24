# Changelog

All notable changes to WeDo Claude Motion. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] — unreleased

First public release, under the MIT license.

### Install
- One-line Windows installer (`scripts/install-windows.ps1`): installs Node.js and pnpm when missing,
  downloads the app, adds desktop shortcuts and offers to connect the Claude app.
- `INSTALL.md` with steps Claude Code follows when asked to install the app.
- `scripts/start.cmd` and `pnpm bridge start` start the app and open the editor.

### Editor
- Import Claude Design project archives, standalone HTML and JSX scenes; every element becomes a layer.
- Layers panel, timeline with draggable Sprite bars, properties, code view, undo and redo.
- Export to MP4, WebM and MOV with alpha, GIF and PNG sequences, rendered with headless Chromium and ffmpeg.
- Real 3D: scenes may import `three` (pinned 0.186.1) and draw a three.js world with the runtime's
  `<Three3D setup render>`, one layer, still a pure function of time. Export waits for its textures,
  renders WebGL on the GPU (SwiftShader fallback, or `MOTION_STUDIO_WEBGL=swiftshader`), and the
  `3D dolly` sample shows a camera move through lit boxes under a 2D title.
- GSAP: scenes may import `gsap` (pinned 3.15.0) and SplitText, DrawSVG, MorphSVG, MotionPath,
  CustomEase and TextPlugin. The runtime's `useGsapTimeline` builds a paused timeline and seeks it to
  the Sprite's local time, so GSAP scrubs and exports frame-exactly; GSAP's own clock is stopped.
  `Kinetic type (GSAP)` sample. GSAP is under GreenSock / Webflow's "Standard No Charge" license,
  not MIT.
- Export and bridge state: when Windows keeps a polled JSON file locked (`status.json` during a
  status poll), the write falls back to rewriting it in place instead of failing with `EPERM`, and
  readers retry a file caught half written (`src/lib/server/jsonFile.ts`).

### Storyboard first
- Every new video starts with 3 style frames to choose from, then a storyboard of shots in the
  chosen style to approve, then the build, in the editor's Storyboard view (`docs/STORYBOARD.md`).
  **Ask Claude → New scene** starts one from the editor; `new` refuses a scene without an approved
  storyboard unless the user asked to skip it.
- A style library of 117 directions with recipes, which Claude picks from and goes beyond.
- Reference images and videos on a storyboard: ffmpeg makes a preview or a contact sheet, which
  Claude looks at in the Code tab, the chat and the autopilot.

### Editor
- Sound layers: `<Audio>` clips from project files or 21 built-in sounds synthesized with ffmpeg
  (effects and loopable beds), synced to the preview and mixed into MP4, WebM, MOV and the PNG zip
  (`docs/AUDIO.md`).
- Move, scale and rotate layers on the canvas; keyframes for X, Y, scale, rotation and opacity in
  Properties → Transform, shown on the timeline; stored as `data-motion` (`docs/TRANSFORM.md`).
- Frame comments (C): click a spot of the frame and tell Claude what to change there.
- Check: a local quality check for cut-off, clipped, overlapping, low-contrast, small, left-to-right
  Persian and too-brief text, and empty or frozen stretches; **Ask Claude to fix** (`docs/QUALITY.md`).
- History: a version is saved when a project opens and after every change Claude makes; restore
  any of them (`docs/VERSIONS.md`).
- Export renders with more pages in parallel: half the logical cores, 2 to 8
  (`MOTION_STUDIO_EXPORT_WORKERS`).

### Claude Code plugin
- `claude plugin marketplace add Sadidi13/wedo-claude-motion`, then
  `claude plugin install wedo-claude-motion@wedo-claude-motion`: Claude Code makes videos in the app
  from any folder, and offers to install the app when it is missing.

### Working with Claude, no API key needed
- **Claude Code sessions** create and edit scenes with `scripts/motion-bridge.mjs` and the
  `motion-studio` skill, and can listen to the editor's Ask Claude tab.
- **Claude chat connector** (MCP) for Claude Desktop: create and edit scenes from the regular chat,
  check the editor's queued requests. `scripts/connect-claude-chat.cmd` registers it on Windows.
- **Autopilot** answers the Ask Claude tab automatically with Claude Code; waiting costs no usage.
- Making a scene starts the editor if needed and opens it in the browser when no tab is open.
- Optional: the Anthropic API with `ANTHROPIC_API_KEY`.

### Security
- The server listens on 127.0.0.1 only and rejects requests from other sites and other hosts.
- Bridge routes that act for Claude require a local token; Claude's answers are validated before the
  editor applies them; the autopilot runs Claude Code without tools.

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

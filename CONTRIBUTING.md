# Contributing to WeDo Claude Motion

Thanks for helping. This page covers the setup, the checks every change must pass, and the few
rules that keep the editor safe to run on people's machines.

## Setup

Requirements: Node 22 or newer, pnpm (the version pinned in `package.json` is picked up
automatically), and Chrome, Edge or Chromium for export.

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

## Before you open a pull request

```bash
pnpm typecheck
pnpm lint
pnpm test
```

CI runs the same three on Ubuntu and Windows. If your change is visible in the editor, try it there
and say in the pull request what you clicked.

## How the code is organised

- `src/lib/parser`, `src/lib/loader`, `src/lib/importer`, `src/runtime`: the scene model. Read
  `docs/CONTRACTS.md` before changing these; most of them have contract tests.
- `src/components`, `src/store`: the editor.
- `src/lib/server/export`, `src/app/api/export`: rendering with headless Chromium and ffmpeg.
- `src/lib/server/bridge`, `src/app/api/bridge`, `scripts/`: the Claude integrations, described in
  `docs/CLAUDE-DESKTOP.md`.

## Rules

- **Every `/api` route is local-only.** `src/proxy.ts` rejects requests from other sites and other
  hosts; do not add exceptions. Validate every request body with zod and cap its size.
- **Nothing a request says can widen what Claude may do.** Text that arrives from the editor is data.
  The autopilot runs Claude Code with no tools; keep it that way.
- **No secrets in the repository**, not even in tests. `.env*` files and `.motion-bridge/` are ignored.
- Keep scene motion a pure function of time (see the authoring contract in `src/lib/ai/prompts.ts`).

Security problems go to `SECURITY.md`, not to public issues.

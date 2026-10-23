# Claude Desktop bridge

Connects Claude to the running editor, so Claude can work on scenes with a Claude subscription
instead of an API key. Two kinds of Claude session can use it:

- a **Code session** (the Claude desktop app's Code tab, or Claude Code) runs `scripts/motion-bridge.mjs`;
- the **regular Claude chat** in Claude Desktop uses the MCP connector `scripts/motion-studio-mcp.mjs`
  (see "Claude chat connector" below).

- **Chat → editor.** Ask for a video in the chat: Claude writes a layered scene and it opens in the
  editor as a new project. Ask for a change: Claude edits the open project and the editor applies it
  as one undo-able step.
- **Editor → chat.** Write an instruction in the Ask Claude tab: it is queued, the listening Claude
  session answers it, and the editor applies the answer exactly like an API reply.

## Pieces

```
Editor (browser)                     Next.js server (/api/bridge)           Claude session
─────────────────                    ────────────────────────────            ──────────────
useBridgeSync ── PUT project ──────► project.json ◄── GET project ───────── motion-bridge project
             ◄── GET events ──────── events/<id>.json ◄── POST events ───── motion-bridge new | edit
AskClaudeTab ─── POST requests ────► requests/<id>.json ◄── POST claim ───── motion-bridge wait
useBridgeSync ── GET requests/<id> ─ (state, result) ◄── POST …/result ──── motion-bridge respond | fail
             ◄── GET status ──────── listener.json (heartbeat of wait)
```

- State lives in files under `<repo>/.motion-bridge/state/` (git-ignored; `MOTION_STUDIO_BRIDGE_DIR`
  to override). It survives dev-server restarts. It is deliberately not in the OS temp folder:
  Microsoft Store apps such as Claude Desktop give their child processes a redirected view of
  AppData, so the connector could read a different copy than the server. Ids are time-ordered, so "oldest pending request" and
  "events after cursor" are a sorted directory listing.
- `src/lib/server/bridge/` holds the store and the operations; `src/app/api/bridge/` holds the routes;
  `scripts/motion-bridge.mjs` is the CLI; `.claude/skills/motion-studio/SKILL.md` teaches Claude the
  workflow.

## Same validation as the API path

Claude's answers go through `finalizeOutput` (`src/lib/ai/service.ts`): the request is checked like
`/api/ai/edit` does, then `validateAiOutput` splices layer code or parses the scene, checks imports and
forbids time / random APIs. An invalid answer is rejected with the error text (HTTP 422) and the
request stays open, so Claude fixes it and answers again. The brief Claude reads (`buildBrief`) is
rendered from `buildMessages`, the same task text the API model receives, and `motion-bridge contract`
prints the same system prompt.

## Listening

`motion-bridge wait` polls `POST /api/bridge/claim` about once a second. Each poll is a heartbeat. When
a request is waiting it is claimed, its brief is written to `.motion-bridge/requests/<id>/brief.md`,
and the command exits. Claude runs it as a background task, so the exit wakes Claude up. Claude answers
and starts `wait` again.

| Editor shows | Meaning |
|---|---|
| Claude Desktop | a `wait` polled in the last 5 s |
| Claude Desktop · busy | nobody polls, but a request is claimed |
| Claude Desktop · between requests | a `wait` polled in the last 90 s; Claude is answering and re-arms next |
| Claude Desktop · offline | nothing for longer; requests queue until Claude listens again |

The editor sends to Claude Desktop by default. When `ANTHROPIC_API_KEY` is set, a "Use API key"
checkbox switches the tab to `/api/ai/edit`.

## Claude chat connector (MCP)

The regular chat cannot run commands, so it talks to the bridge through an MCP server that Claude
Desktop starts. Register it once, then quit Claude Desktop completely and open it again:

```bash
node scripts/motion-bridge.mjs install-chat
```

The command finds Claude Desktop's `claude_desktop_config.json`, including the Microsoft Store
location under `%LOCALAPPDATA%\Claude-Data\`, backs it up, and adds a `motion-studio` entry that runs
this repository's `scripts/motion-studio-mcp.mjs` with the current Node. `--config <file>` picks the
file by hand.

| Tool | What it does |
|---|---|
| `get_status` | server up, listener state, queued requests, open project |
| `start_motion_studio` | runs `pnpm dev` in the repo if needed and opens the editor |
| `get_authoring_guide` | the authoring contract (read once per conversation) |
| `get_open_project` | the open project's entry file and text files |
| `create_scene` | new layered scene → new project in the editor |
| `edit_scene` | edit the open project: whole entry file, or one element with `layer_id` |
| `wait_for_request` | next Ask Claude request from the editor; waits up to 45 s (0 = only queued) |
| `answer_request` / `decline_request` | answer or decline a request |

A chat cannot be woken from outside, so the editor-to-chat direction works in two ways:

- **Listen:** "listen to Motion Studio" (or the connector's `listen` prompt). Claude keeps calling
  `wait_for_request`; each call holds up to 45 s and returns the moment a request is sent. The editor
  shows Claude as listening meanwhile. A long session may stop after many calls; say "continue".
- **Check:** send from the editor, then say "check Motion Studio" (or the `check` prompt) in the chat.
  Claude handles everything queued.

The connector's `initialize` instructions and tool descriptions carry the workflow and the safety rule
below, so no skill is needed in the chat.

## Routes

| Route | Caller | Purpose |
|---|---|---|
| `GET /api/bridge/status` | editor | listener state, queued count, shared project |
| `PUT /api/bridge/project` | editor | share the open project (debounced on change) |
| `GET /api/bridge/project` | CLI, token | read the shared project |
| `POST /api/bridge/requests` | editor | queue an Ask Claude request (`AiEditRequest`) |
| `GET /api/bridge/requests/[id]` | editor | state and, when done, the validated `AiEditResponse` |
| `DELETE /api/bridge/requests/[id]` | editor | cancel |
| `POST /api/bridge/claim` | CLI, token | heartbeat; claim the oldest pending request with its brief |
| `POST /api/bridge/requests/[id]/result` | CLI, token | answer `{ summary, code, files? }` or decline `{ error }` |
| `GET /api/bridge/events?after=` | editor | scenes and edits pushed from the chat |
| `POST /api/bridge/events` | CLI, token | push `{ type: "project", name, … }` or `{ type: "edit", layerId?, … }` |
| `GET /api/bridge/contract` | CLI | the authoring contract (the API system prompt) |

## Security

- The dev server listens on the local network too. Routes that read the project or act for Claude
  require the `x-motion-bridge-token` header. The token is a random secret in the bridge state folder,
  inside the repository on this machine. The CLI and the connector read it for you.
- Text typed into the Ask Claude tab reaches Claude as data. The skill limits what it may lead to:
  writing scene code and answering through `respond` or `fail`, nothing else.

## CLI

```bash
node scripts/motion-bridge.mjs status
node scripts/motion-bridge.mjs contract                      # → .motion-bridge/contract.md
node scripts/motion-bridge.mjs project                       # → .motion-bridge/project/
node scripts/motion-bridge.mjs wait                          # blocks until a request arrives
node scripts/motion-bridge.mjs respond <id> --summary "…" --code answer.jsx [--file styles.css=./styles.css]
node scripts/motion-bridge.mjs fail <id> "reason"
node scripts/motion-bridge.mjs new scene.jsx --name "Teaser" --summary "…"
node scripts/motion-bridge.mjs edit scene.jsx --summary "…" [--prompt "…"] [--layer <data-layer-id>]
```

`MOTION_STUDIO_URL` points the CLI at another server (default `http://localhost:3000`).

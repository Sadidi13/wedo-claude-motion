# Security

## Reporting a vulnerability

Please report security problems privately through GitHub: **Security → Report a vulnerability** on
this repository. Do not open a public issue. Include what you did, what happened and, if you can, a
minimal project or request that shows it. You will get an answer within a week; please give us a
reasonable time to fix it before you talk about it publicly.

Never include real API keys, bridge tokens or private projects in a report.

## Supported versions

Only the latest release and the `main` branch receive security fixes.

## Threat model

WeDo Claude Motion is a **local** tool: a Next.js server and an editor in your own browser, plus
optional helpers that let Claude (Claude Code, the Claude Desktop chat, the autopilot) work with it.
It is not meant to be deployed on a public server.

What it defends against:

| Threat | Defence |
|---|---|
| Other machines on the network | The server listens on 127.0.0.1 only (`pnpm dev` / `pnpm start`). |
| A web page you visit attacking `localhost` (CSRF) | `src/proxy.ts` refuses cross-site `/api` requests (Sec-Fetch-Site / Origin) and non-JSON writes. |
| DNS rebinding | Only `localhost`, `127.0.0.1` and `[::1]` host names are answered. |
| Clickjacking, MIME sniffing | `frame-ancestors 'self'`, `nosniff`, `Referrer-Policy`, `Cross-Origin-Resource-Policy`. |
| Another local program posing as Claude | Routes that read projects or answer requests need a random token in `.motion-bridge/state/token` (owner-only permissions on macOS and Linux). |
| Path traversal | Project file paths are checked on the server and again where the CLI writes them; zip import rejects escaping paths; job and request ids are validated. |
| Broken or hostile answers from Claude | Every answer is parsed and validated (imports allow-list, no timers or randomness, layer ids kept) before the editor applies it; each applied change is one Undo. |
| Prompt injection through editor requests | Requests are labelled as untrusted data in the brief. The autopilot runs Claude Code with no tools, no MCP servers, no settings and in an empty temporary folder, so a request can only produce scene code. |
| Resource exhaustion | Request bodies up to 64 MB; stage up to 4096 px, 10 minutes, 120 fps, 36,000 frames; one export at a time; at most 20 queued requests; old jobs and requests are deleted. |
| Rendered scenes escaping export | Chromium runs with its sandbox on, and the rendered page can only load itself, the app's bundles and its own job; it cannot call `/api`. |

## Known limitations

- **Imported projects are code.** A project is JavaScript that runs in the editor's own origin,
  like opening an HTML file from someone. It can use the editor's API (queue requests for Claude,
  start an export, use your `ANTHROPIC_API_KEY` if you set one). Only import projects you trust.
  Moving the preview to a separate origin is planned.
- **Claude Code sessions that listen to the editor** (`motion-bridge wait`) have their usual tools.
  The brief marks editor text as untrusted and the `motion-studio` skill forbids acting on it, but a
  model can still be misled. Prefer the autopilot, which has no tools, or run listening sessions
  with a narrow permission allow-list (for example only `Bash(node scripts/motion-bridge.mjs:*)`).
- **`scripts/connect-claude-chat.cmd` and `install-chat` edit Claude Desktop's config file.** A
  backup is written next to it first.
- **ffmpeg** comes from `ffmpeg-static`, which downloads a prebuilt binary at install time.
  Set `FFMPEG_PATH` to use an ffmpeg you installed yourself.

## Secrets

`.env*` files (except `.env.example`) and `.motion-bridge/` are git-ignored. The Anthropic API key
is only read on the server and never sent to the browser. The bridge token never leaves this
machine: the CLI refuses to send it to a non-local http address.

/**
 * HTTP client for the Motion Studio bridge (docs/CLAUDE-DESKTOP.md), shared by
 * the `motion-bridge` CLI and the `motion-studio-mcp` connector. No
 * dependencies. Reads the access token from the bridge state folder, which the
 * server creates on first use.
 *
 * Finding the server: MOTION_STUDIO_URL when set; otherwise the port the server recorded in
 * <bridge state>/server.json, then ports 3000-3005 (where `next dev` lands when 3000 is taken).
 * A candidate only counts when its /api/bridge/status reports this checkout's instance id.
 *
 * Environment: MOTION_STUDIO_URL, MOTION_STUDIO_BRIDGE_DIR (default <repo>/.motion-bridge/state,
 * same as the server).
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, openSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SCRATCH = path.join(REPO, ".motion-bridge");
export const BRIDGE_DIR = process.env.MOTION_STUDIO_BRIDGE_DIR || path.join(SCRATCH, "state");
const TOKEN_HEADER = "x-motion-bridge-token";
const DEFAULT_PORT = 3000;
const FALLBACK_PORTS = [3000, 3001, 3002, 3003, 3004, 3005];
const FIXED_URL = process.env.MOTION_STUDIO_URL ? process.env.MOTION_STUDIO_URL.replace(/\/+$/, "") : null;

/**
 * The editor's address. A live binding: it starts at the recorded or default port and is updated
 * when resolveBase() finds the server somewhere else. Always "localhost" (not 127.0.0.1), because the
 * editor's autosaves live in the browser storage of the localhost origin.
 */
export let BASE = FIXED_URL ?? `http://localhost:${recordedPort() ?? DEFAULT_PORT}`;

/** The token must never travel in clear text to another machine. */
function assertSafeBase(base) {
  const url = new URL(base);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.hostname.endsWith(".localhost");
  if (!loopback && url.protocol !== "https:" && process.env.MOTION_STUDIO_ALLOW_REMOTE !== "1") {
    throw new Error(`MOTION_STUDIO_URL ${base} is not on this machine and not https; refusing to send the bridge token there`);
  }
}
assertSafeBase(BASE);

/** Same id the server computes from its bridge folder (src/lib/server/bridge/server-info.ts). */
export const INSTANCE_ID = (() => {
  const resolved = path.resolve(BRIDGE_DIR);
  const normalised = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  return createHash("sha256").update(normalised).digest("hex").slice(0, 16);
})();

function recordedPort() {
  try {
    const info = JSON.parse(readFileSync(path.join(BRIDGE_DIR, "server.json"), "utf8"));
    return Number.isInteger(info?.port) && info.port > 0 ? info.port : null;
  } catch {
    return null;
  }
}

/** True when `base` answers with this checkout's bridge status (no token is sent while probing). */
async function isOurServer(base) {
  try {
    const response = await fetch(`${base}/api/bridge/status`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return false;
    const status = await response.json();
    return status?.instance === INSTANCE_ID;
  } catch {
    return false;
  }
}

let confirmedBase = null;

/**
 * Find this checkout's server and point BASE at it. Returns the address, or null when no server of
 * ours answers (BASE then keeps the recorded or default address, used to start one).
 */
export async function resolveBase({ refresh = false } = {}) {
  if (FIXED_URL) return FIXED_URL;
  if (confirmedBase && !refresh) return confirmedBase;
  confirmedBase = null;
  const recorded = recordedPort();
  const ports = [...new Set([...(recorded ? [recorded] : []), ...FALLBACK_PORTS])];
  for (const port of ports) {
    const base = `http://localhost:${port}`;
    if (await isOurServer(base)) {
      confirmedBase = base;
      BASE = base;
      return base;
    }
  }
  BASE = `http://localhost:${recorded ?? DEFAULT_PORT}`;
  return null;
}

/** Something the user or Claude can act on: server down, no token, bad id, … */
export class BridgeError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "BridgeError";
    this.status = status;
  }
}

/** The answer or scene broke the authoring contract; the message says what to fix. */
export class BridgeValidationError extends BridgeError {
  constructor(message) {
    super(message, 422);
    this.name = "BridgeValidationError";
  }
}

async function readToken() {
  try {
    return (await readFile(path.join(BRIDGE_DIR, "token"), "utf8")).trim();
  } catch {
    return null;
  }
}

/** Raw request: `{ status, json, text }`. Throws BridgeError only when the server is unreachable. */
export async function request(method, route, { body, auth = false, signal } = {}) {
  if (!(await resolveBase())) {
    throw new BridgeError(`WeDo Claude Motion is not running (looked at ${BASE} and ports 3000-3005). Start it with "pnpm dev" in ${REPO}.`);
  }
  const send = async (token) => {
    const headers = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token) headers[TOKEN_HEADER] = token;
    let response;
    try {
      response = await fetch(`${BASE}${route}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      confirmedBase = null; // the server went away: look for it again next time
      throw new BridgeError(
        `WeDo Claude Motion is not running at ${BASE} (${error?.cause?.code ?? error?.message}). Start it with "pnpm dev" in ${REPO}.`,
      );
    }
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json, text };
  };
  let result = await send(auth ? await readToken() : null);
  // The server creates the token on its first authenticated request; read it and retry once.
  if (auth && result.status === 401) {
    const token = await readToken();
    if (!token) {
      throw new BridgeError(`No bridge token in ${BRIDGE_DIR}. The server and this tool must share MOTION_STUDIO_BRIDGE_DIR.`, 401);
    }
    result = await send(token);
  }
  return result;
}

function failure(result, what) {
  const detail = result.json?.error ?? result.text ?? "";
  if (result.status === 422) return new BridgeValidationError(detail);
  return new BridgeError(`${what} failed (HTTP ${result.status})${detail ? `: ${detail}` : ""}`, result.status);
}

/** `{ listener, lastSeen, pending, project }` */
export async function getStatus() {
  const result = await request("GET", "/api/bridge/status");
  if (result.status !== 200) throw failure(result, "status");
  return result.json;
}

/** The authoring contract (Markdown). */
export async function getContract() {
  const result = await request("GET", "/api/bridge/contract");
  if (result.status !== 200) throw failure(result, "contract");
  return result.text;
}

/**
 * The quality check (docs/QUALITY.md) of the scene a pushed event made (`eventId`), or of the project
 * open in the editor. Resolves with `{ report, text }`. Rendering takes a few seconds to a minute.
 */
export async function checkQuality(eventId) {
  const result = await request("POST", "/api/bridge/qa", { body: eventId ? { eventId } : {}, auth: true });
  if (result.status !== 200) throw failure(result, "quality check");
  return result.json;
}

/** The style library with its recipes (Markdown). */
export async function getStyleLibrary() {
  const result = await request("GET", "/api/bridge/contract?part=styles");
  if (result.status !== 200) throw failure(result, "style library");
  return result.text;
}

/**
 * A board's reference previews as `{ ref, file }` with absolute paths (the server and these tools
 * share the bridge folder, so the files are read straight from it).
 */
export function boardReferenceFiles(board) {
  if (!BOARD_ID.test(board.id)) return [];
  return (board.references ?? [])
    .filter((ref) => /^r\d{1,2}\.preview\.jpg$/.test(ref.preview))
    .map((ref) => ({ ref, file: path.join(BRIDGE_DIR, "refs", board.id, ref.preview) }));
}

/** `{ project, syncedAt }` — the project open in the editor. */
export async function getProject() {
  const result = await request("GET", "/api/bridge/project", { auth: true });
  if (result.status !== 200) throw failure(result, "project");
  return result.json;
}

/**
 * Heartbeat + claim the oldest queued request: the request with its brief, or null.
 * `client: "mcp" | "headless"` words the brief for the connector's tools or the autopilot.
 */
export async function claim({ signal, client = "cli" } = {}) {
  const route = client === "cli" ? "/api/bridge/claim" : `/api/bridge/claim?client=${encodeURIComponent(client)}`;
  const result = await request("POST", route, { auth: true, signal });
  if (result.status === 204) return null;
  if (result.status !== 200) throw failure(result, "claim");
  return result.json;
}

/** Answer a claimed request with `{ summary, code, files? }`. */
export async function answer(id, body) {
  const result = await request("POST", `/api/bridge/requests/${encodeURIComponent(id)}/result`, { body, auth: true });
  if (result.status !== 200) throw failure(result, "answer");
  return result.json;
}

/** Decline a request with a short reason shown in the editor. */
export async function decline(id, reason) {
  const result = await request("POST", `/api/bridge/requests/${encodeURIComponent(id)}/result`, {
    body: { error: reason },
    auth: true,
  });
  if (result.status !== 200) throw failure(result, "decline");
  return result.json;
}

/** Push `{ type: "project", name, summary, code, files? }` or `{ type: "edit", summary, code, prompt?, layerId?, files? }`. */
export async function push(body) {
  const result = await request("POST", "/api/bridge/events", { body, auth: true });
  if (result.status !== 201) throw failure(result, body.type === "project" ? "new scene" : "edit");
  return result.json;
}

// ---------------------------------------------------------------------------
// Storyboards (docs/STORYBOARD.md)
// ---------------------------------------------------------------------------

/**
 * Style frames: `{ boardId?, title?, brief?, stage?, styles: [{ name, description, time, code, files? }] }`.
 * Without boardId a new board is created. Resolves with the board.
 */
export async function proposeStyles(body) {
  const result = await request("POST", "/api/bridge/boards", { body, auth: true });
  if (result.status !== 201) throw failure(result, "style frames");
  return result.json.board;
}

/** Storyboard for a board with a chosen style: `{ notes?, shots: [...] }`. Resolves with the board. */
export async function proposeStoryboard(boardId, body) {
  const result = await request("POST", `/api/bridge/boards/${encodeURIComponent(boardId)}/storyboard`, { body, auth: true });
  if (result.status !== 200) throw failure(result, "storyboard");
  return result.json.board;
}

export async function getBoard(boardId) {
  const result = await request("GET", `/api/bridge/boards/${encodeURIComponent(boardId)}`);
  if (result.status !== 200) throw failure(result, "board");
  return result.json;
}

/** Board summaries, newest first. */
export async function listBoards() {
  const result = await request("GET", "/api/bridge/boards");
  if (result.status !== 200) throw failure(result, "boards");
  return result.json.boards;
}

/**
 * Record a decision the designer told Claude in the chat (`{ action, styleId?, note? }`); with the
 * token nothing is queued, because Claude already handles the next step.
 */
export async function recordBoardDecision(boardId, body) {
  const result = await request("POST", `/api/bridge/boards/${encodeURIComponent(boardId)}`, { body, auth: true });
  if (result.status !== 200) throw failure(result, "board decision");
  return result.json.board;
}

const BOARD_ID = /^[0-9a-z]{15}$/;

/** Open the storyboard view in the browser unless an editor tab is open (it opens the board by itself). */
export async function showBoard(boardId) {
  if (!BOARD_ID.test(boardId)) throw new BridgeError(`Invalid board id "${boardId}"`);
  const status = await tryStatus();
  if (status?.editorOpen) return false;
  openInBrowser(`${BASE}/?board=${boardId}`);
  return true;
}

/** What Claude tells the user after delivering a storyboard step, so they know where to decide. */
export const BOARD_NEXT_STEP = {
  styles: {
    fa:
      "فریم‌های استایل در WeDo Claude Motion (پنجرهٔ Storyboard) آماده‌اند. یکی را همان‌جا انتخاب کن و بعد اینجا بنویس «کلاد موشن رو چک کن»، " +
      "یا همین‌جا بگو کدام را می‌خواهی (با حرف یا اسمش).",
    en:
      'The style frames are ready in the Storyboard view of WeDo Claude Motion. Choose one there and then write "check Claude Motion" here, ' +
      "or tell me here which one you want (by letter or name).",
  },
  storyboard: {
    fa:
      "استوری‌بورد در WeDo Claude Motion آماده است. اگر خوب است همان‌جا «Approve» را بزن و بعد اینجا بنویس «کلاد موشن رو چک کن»، " +
      "یا همین‌جا بگو تأیید است یا چه چیزی عوض شود.",
    en:
      'The storyboard is ready in WeDo Claude Motion. Approve it there and then write "check Claude Motion" here, ' +
      "or tell me here whether it is approved or what should change.",
  },
};

/** One line per board step, for the tools' replies. */
export function describeBoard(board) {
  const chosen = board.styles?.find((style) => style.id === board.chosenStyleId);
  const step = {
    "styles-pending": "waiting for style frames",
    "choose-style": "the designer is choosing a style",
    "storyboard-pending": `style "${chosen?.name ?? board.chosenStyleId}" chosen; waiting for the storyboard`,
    storyboard: "the designer is reviewing the storyboard",
    "build-pending": "storyboard approved; waiting for the video to be built",
    built: `built (project ${board.projectId})`,
  }[board.status];
  const lines = [
    `Board "${board.title}" (${board.id}): ${step}.`,
    `Video: ${board.meta.width}x${board.meta.height}, ${board.meta.duration}s at ${board.meta.fps} fps.`,
  ];
  if (board.styles?.length) lines.push(`Styles: ${board.styles.map((s) => `${s.id} "${s.name}"${s.id === board.chosenStyleId ? " (chosen)" : ""}`).join(", ")}.`);
  if (board.shots?.length) lines.push(`Storyboard: ${board.shots.length} shots (revision ${board.storyboardRevision}).`);
  for (const note of board.notes ?? []) lines.push(`Designer's note (${note.stage}): ${note.text}`);
  if (board.lastError) lines.push(`Last step was declined: ${board.lastError}`);
  return lines.join("\n");
}

export const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

// ---------------------------------------------------------------------------
// Server and browser
// ---------------------------------------------------------------------------

const EVENT_ID = /^[0-9a-z]{15}$/;

/** Status, or null when the server is not reachable. */
export async function tryStatus() {
  try {
    return await getStatus();
  } catch (error) {
    if (error instanceof BridgeError && error.status === 0) return null;
    throw error;
  }
}

/**
 * Make sure the editor's server runs: when it does not answer, start `pnpm dev` in the
 * repository as its own detached process (log: .motion-bridge/dev-server.log) and wait for it.
 */
export async function ensureServer({ timeoutSeconds = 90 } = {}) {
  let status = await tryStatus();
  if (status) return { status, started: false };
  mkdirSync(SCRATCH, { recursive: true });
  const log = openSync(path.join(SCRATCH, "dev-server.log"), "a");
  const [command, args] = process.platform === "win32" ? ["cmd.exe", ["/d", "/s", "/c", "pnpm dev"]] : ["pnpm", ["dev"]];
  spawn(command, args, { cwd: REPO, detached: true, stdio: ["ignore", log, log], windowsHide: true }).unref();
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    await sleep(1500);
    status = await tryStatus();
    if (status) return { status, started: true };
  }
  throw new BridgeError(
    `Started "pnpm dev" in ${REPO}, but it did not answer within ${timeoutSeconds} s. See ${path.join(SCRATCH, "dev-server.log")}.`,
  );
}

/** The editor's URL; with an event id the freshly opened tab applies that scene or edit. */
export function editorUrl(eventId, { lead = false } = {}) {
  if (eventId && EVENT_ID.test(eventId)) return `${BASE}/?event=${eventId}`;
  return lead ? `${BASE}/?lead=1` : `${BASE}/`;
}

/** Open a URL built by editorUrl() in the default browser (never a URL taken from user text). */
export function openInBrowser(url) {
  if (!url.startsWith(`${BASE}/`)) throw new BridgeError(`Refusing to open ${url}`);
  const [command, args] =
    process.platform === "win32"
      ? ["cmd.exe", ["/d", "/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

/**
 * After a scene or edit was pushed: open the editor in the browser unless a tab is already
 * open (that tab picks the change up by itself). Returns true when a browser tab was opened.
 */
export async function showInEditor(eventId) {
  const status = await tryStatus();
  if (status?.editorOpen) return false;
  openInBrowser(editorUrl(eventId));
  return true;
}

/**
 * What Claude tells the user at the end of a reply that made or changed a scene, so they know
 * how to continue from the editor. Persian first (the owner's language), English for others.
 */
export const NEXT_STEP_NOTE = {
  fa:
    "اگر تغییری می‌خواهی، آن را در WeDo Claude Motion در تب Ask Claude بنویس و بعد اینجا بنویس «کلاد موشن رو چک کن». " +
    "یا اتوپایلوت را باز بگذار (فایل scripts/start-autopilot.cmd) تا تغییرها خودکار انجام شوند. تغییر را همین‌جا هم می‌توانی از من بخواهی.",
  en:
    'To change it, type in the Ask Claude tab of WeDo Claude Motion, then write "check Claude Motion" here. ' +
    "Or keep the autopilot open (scripts/start-autopilot.cmd) and changes are applied automatically. You can also ask me for the change right here.",
};

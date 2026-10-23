/**
 * HTTP client for the Motion Studio bridge (docs/CLAUDE-DESKTOP.md), shared by
 * the `motion-bridge` CLI and the `motion-studio-mcp` connector. No
 * dependencies. Reads the access token from the bridge state folder, which the
 * server creates on first use.
 *
 * Environment: MOTION_STUDIO_URL (default http://localhost:3000),
 * MOTION_STUDIO_BRIDGE_DIR (default <repo>/.motion-bridge/state, same as the server).
 */
import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SCRATCH = path.join(REPO, ".motion-bridge");
export const BASE = (process.env.MOTION_STUDIO_URL || "http://localhost:3000").replace(/\/+$/, "");
export const BRIDGE_DIR = process.env.MOTION_STUDIO_BRIDGE_DIR || path.join(SCRATCH, "state");
const TOKEN_HEADER = "x-motion-bridge-token";

/** The token must never travel in clear text to another machine. */
function assertSafeBase(base) {
  const url = new URL(base);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.hostname.endsWith(".localhost");
  if (!loopback && url.protocol !== "https:" && process.env.MOTION_STUDIO_ALLOW_REMOTE !== "1") {
    throw new Error(`MOTION_STUDIO_URL ${base} is not on this machine and not https; refusing to send the bridge token there`);
  }
}
assertSafeBase(BASE);

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
      throw new BridgeError(
        `Motion Studio is not running at ${BASE} (${error?.cause?.code ?? error?.message}). Start it with "pnpm dev" in ${REPO}.`,
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
export function editorUrl(eventId) {
  return eventId && EVENT_ID.test(eventId) ? `${BASE}/?event=${eventId}` : `${BASE}/`;
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

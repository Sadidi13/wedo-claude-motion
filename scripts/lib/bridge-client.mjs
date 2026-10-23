/**
 * HTTP client for the Motion Studio bridge (docs/CLAUDE-DESKTOP.md), shared by
 * the `motion-bridge` CLI and the `motion-studio-mcp` connector. No
 * dependencies. Reads the access token from the bridge state folder, which the
 * server creates on first use.
 *
 * Environment: MOTION_STUDIO_URL (default http://localhost:3000),
 * MOTION_STUDIO_BRIDGE_DIR (default <repo>/.motion-bridge/state, same as the server).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SCRATCH = path.join(REPO, ".motion-bridge");
export const BASE = (process.env.MOTION_STUDIO_URL || "http://localhost:3000").replace(/\/+$/, "");
export const BRIDGE_DIR = process.env.MOTION_STUDIO_BRIDGE_DIR || path.join(SCRATCH, "state");
const TOKEN_HEADER = "x-motion-bridge-token";

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
 * `client: "mcp"` words the brief for the connector's tools instead of the CLI.
 */
export async function claim({ signal, client = "cli" } = {}) {
  const route = client === "mcp" ? "/api/bridge/claim?client=mcp" : "/api/bridge/claim";
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

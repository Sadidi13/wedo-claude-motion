/**
 * File-backed state of the Claude Desktop bridge (docs/CLAUDE-DESKTOP.md).
 * Everything lives under `<repo>/.motion-bridge/state/` (git-ignored; override:
 * MOTION_STUDIO_BRIDGE_DIR), so it survives dev-server restarts and Turbopack
 * reloads, and the CLI and the MCP connector find the token at a path every
 * process sees the same way. (Not the OS temp folder: Microsoft Store apps such
 * as Claude Desktop give their child processes a redirected view of AppData.)
 *
 *   token               random secret; the CLI-only routes require it
 *   project.json        the project the editor last shared ({ project, syncedAt })
 *   listener.json       { lastSeen, client } — heartbeat of whoever claims requests
 *   editor.json         { lastSeen } — heartbeat of the open editor tab (its event polls)
 *   requests/<id>.json  one Ask Claude request from the editor and its outcome
 *   events/<id>.json    scenes / edits Claude pushed from the desktop chat
 *   boards/<id>.json    storyboards (style frames → storyboard → build), see boards.ts
 *
 * Ids are time-ordered ([0-9a-z], lexicographic order = creation order), so
 * "next pending request" and "events after cursor" are a sorted directory
 * listing. Writes are atomic (temp file + rename, retried on Windows locks).
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { customAlphabet } from "nanoid";
import type {
  AiEditRequest,
  AiEditResponse,
  BoardAction,
  BridgeClient,
  BridgeEvent,
  BridgeRequestState,
  BridgeRequestView,
  BridgeStatus,
  Project,
} from "@/lib/types";

/** A listener that polled within this window counts as "listening". */
export const LISTENER_TTL_MS = 5_000;
/**
 * An editor tab polls events every 1.5 s, but browsers throttle timers in background tabs (down to
 * once a minute), so a tab seen within this window counts as open; tools then avoid opening a second one.
 */
export const EDITOR_TTL_MS = 75_000;
/** A claimed request older than this no longer makes the listener "busy". */
export const CLAIM_TTL_MS = 30 * 60_000;
/** How many pushed events are kept on disk. */
export const MAX_EVENTS = 50;
/** Requests older than this (finished, or never answered) are deleted when a new one is created. */
export const FINISHED_REQUEST_TTL_MS = 24 * 60 * 60_000;
/** The queue refuses new requests beyond this many waiting ones. */
export const MAX_PENDING_REQUESTS = 20;

export const BRIDGE_ID_PATTERN = /^[0-9a-z]{15}$/;
export const TOKEN_HEADER = "x-motion-bridge-token";

/** A storyboard step the editor queued for Claude (the request's `request` then only carries the stage meta). */
export interface BoardRequestInfo {
  boardId: string;
  action: BoardAction;
  /** the designer's note for this step */
  note?: string;
}

export interface BridgeRequestRecord {
  id: string;
  state: BridgeRequestState;
  createdAt: string;
  claimedAt?: string;
  finishedAt?: string;
  request: AiEditRequest;
  /** set for storyboard steps; they are finished by the board update Claude sends, not by an answer */
  board?: BoardRequestInfo;
  result?: AiEditResponse;
  error?: string;
}

export interface SyncedProject {
  project: Project;
  syncedAt: string;
}

/** `next dev` / `next start` run with the repository as the working directory. */
export function bridgeRoot(): string {
  return process.env.MOTION_STUDIO_BRIDGE_DIR || path.join(process.cwd(), ".motion-bridge", "state");
}

const randomSuffix = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 6);
let lastIdTime = 0;

/** 9 base36 chars of a strictly increasing millisecond clock + 6 random chars. */
export function newBridgeId(now = Date.now()): string {
  lastIdTime = Math.max(now, lastIdTime + 1);
  return lastIdTime.toString(36).padStart(9, "0") + randomSuffix();
}

export function isValidBridgeId(id: string): boolean {
  return BRIDGE_ID_PATTERN.test(id);
}

const requestsDir = () => path.join(bridgeRoot(), "requests");
const eventsDir = () => path.join(bridgeRoot(), "events");

function requestFile(id: string): string {
  if (!isValidBridgeId(id)) throw new Error(`Invalid bridge request id "${id}"`);
  return path.join(requestsDir(), `${id}.json`);
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

const RETRYABLE_RENAME = new Set(["EPERM", "EBUSY", "EACCES"]);

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomSuffix()}.tmp`;
  await writeFile(tmp, JSON.stringify(value), "utf8");
  // Windows refuses to replace a file another handle is reading; the readers are quick.
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, file);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (attempt >= 5 || !RETRYABLE_RENAME.has(code)) {
        await rm(tmp, { force: true });
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
}

export async function listIds(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir))
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length))
      .filter(isValidBridgeId)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

// Read-modify-write of request files is serialised so a claim cannot interleave with a result.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.catch(() => undefined).then(task);
  queue = next;
  return next;
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

/** The bridge secret, created on first use (readable by the CLI from the same machine). */
export async function bridgeToken(): Promise<string> {
  const file = path.join(bridgeRoot(), "token");
  try {
    const existing = (await readFile(file, "utf8")).trim();
    if (existing) return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // Owner-only permissions where the OS has them (POSIX); on Windows the user profile already is.
  await mkdir(bridgeRoot(), { recursive: true, mode: 0o700 });
  const token = randomBytes(24).toString("hex");
  try {
    await writeFile(file, token, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return token;
  } catch (error) {
    // Another request created it first: use that one.
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return (await readFile(file, "utf8")).trim();
    throw error;
  }
}

export async function isValidToken(candidate: string | null): Promise<boolean> {
  // Create the token even when none was sent, so the CLI can read it after its first 401.
  const expected = Buffer.from(await bridgeToken());
  if (!candidate) return false;
  const given = Buffer.from(candidate.trim());
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ---------------------------------------------------------------------------
// Project shared by the editor
// ---------------------------------------------------------------------------

export async function syncProject(project: Project, now = new Date()): Promise<SyncedProject> {
  const synced: SyncedProject = { project, syncedAt: now.toISOString() };
  await writeJsonAtomic(path.join(bridgeRoot(), "project.json"), synced);
  return synced;
}

export function readSyncedProject(): Promise<SyncedProject | null> {
  return readJson<SyncedProject>(path.join(bridgeRoot(), "project.json"));
}

// ---------------------------------------------------------------------------
// Requests (editor → Claude)
// ---------------------------------------------------------------------------

export function toView(record: BridgeRequestRecord): BridgeRequestView {
  const { request: _request, ...view } = record;
  void _request;
  return view;
}

/**
 * Delete finished requests older than FINISHED_REQUEST_TTL_MS and requests nobody answered within
 * the same time (stale queue entries would otherwise wait forever). Returns the pending count left.
 */
async function pruneRequests(now: number): Promise<number> {
  let pending = 0;
  for (const id of await listIds(requestsDir())) {
    const record = await readJson<BridgeRequestRecord>(requestFile(id));
    if (!record) continue;
    const open = record.state === "pending" || record.state === "claimed";
    const since = Date.parse(open ? record.createdAt : (record.finishedAt ?? record.createdAt));
    if (now - since > FINISHED_REQUEST_TTL_MS) {
      await rm(requestFile(id), { force: true });
      continue;
    }
    if (record.state === "pending") pending++;
  }
  return pending;
}

export function createRequest(request: AiEditRequest, now = new Date(), board?: BoardRequestInfo): Promise<BridgeRequestRecord> {
  return serial(async () => {
    const pending = await pruneRequests(now.getTime());
    if (pending >= MAX_PENDING_REQUESTS) {
      throw new BridgeStateError(`${pending} requests are already waiting; let Claude answer them or cancel some first`, 429);
    }
    const record: BridgeRequestRecord = {
      id: newBridgeId(now.getTime()),
      state: "pending",
      createdAt: now.toISOString(),
      request,
      ...(board ? { board } : {}),
    };
    await writeJsonAtomic(requestFile(record.id), record);
    return record;
  });
}

export function readRequest(id: string): Promise<BridgeRequestRecord | null> {
  if (!isValidBridgeId(id)) return Promise.resolve(null);
  return readJson<BridgeRequestRecord>(requestFile(id));
}

export async function touchListener(now = Date.now(), client: BridgeClient = "cli"): Promise<void> {
  await writeJsonAtomic(path.join(bridgeRoot(), "listener.json"), { lastSeen: now, client });
}

/** Heartbeat + claim the oldest pending request (null when there is none). */
export function claimNextRequest(now = new Date(), client: BridgeClient = "cli"): Promise<BridgeRequestRecord | null> {
  return serial(async () => {
    await touchListener(now.getTime(), client);
    for (const id of await listIds(requestsDir())) {
      const record = await readJson<BridgeRequestRecord>(requestFile(id));
      if (record?.state !== "pending") continue;
      const claimed: BridgeRequestRecord = { ...record, state: "claimed", claimedAt: now.toISOString() };
      await writeJsonAtomic(requestFile(id), claimed);
      return claimed;
    }
    return null;
  });
}

export class BridgeStateError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BridgeStateError";
  }
}

/** `handled`: a storyboard step Claude completed with a board update (there is no edit to apply). */
export type RequestOutcome = { result: AiEditResponse } | { error: string } | { cancelled: true } | { handled: true };

/**
 * Finish a request. Only pending / claimed requests can be finished; a
 * cancelled or already-finished one throws BridgeStateError (409), an unknown
 * id BridgeStateError (404).
 */
export function finishRequest(id: string, outcome: RequestOutcome, now = new Date()): Promise<BridgeRequestRecord> {
  return serial(async () => {
    const record = await readRequest(id);
    if (!record) throw new BridgeStateError(`Unknown request "${id}"`, 404);
    if (record.state !== "pending" && record.state !== "claimed") {
      throw new BridgeStateError(`Request "${id}" is already ${record.state}`, 409);
    }
    const finishedAt = now.toISOString();
    let next: BridgeRequestRecord;
    if ("result" in outcome) next = { ...record, state: "done", result: outcome.result, finishedAt };
    else if ("error" in outcome) next = { ...record, state: "error", error: outcome.error, finishedAt };
    else if ("handled" in outcome) next = { ...record, state: "done", finishedAt };
    else next = { ...record, state: "cancelled", finishedAt };
    await writeJsonAtomic(requestFile(id), next);
    return next;
  });
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Called on every event poll of the editor, so tools know whether a tab is open. */
export async function touchEditor(now = Date.now()): Promise<void> {
  await writeJsonAtomic(path.join(bridgeRoot(), "editor.json"), { lastSeen: now });
}

export async function bridgeStatus(now = Date.now()): Promise<BridgeStatus> {
  const [listener, editor, synced, ids] = await Promise.all([
    readJson<{ lastSeen: number; client?: BridgeClient }>(path.join(bridgeRoot(), "listener.json")),
    readJson<{ lastSeen: number }>(path.join(bridgeRoot(), "editor.json")),
    readSyncedProject(),
    listIds(requestsDir()),
  ]);
  let pending = 0;
  let claimed = false;
  for (const id of ids) {
    const record = await readJson<BridgeRequestRecord>(requestFile(id));
    if (record?.state === "pending") pending++;
    if (record?.state === "claimed" && now - Date.parse(record.claimedAt ?? record.createdAt) < CLAIM_TTL_MS) {
      claimed = true;
    }
  }
  const lastSeen = listener?.lastSeen ?? null;
  const listening = lastSeen !== null && now - lastSeen < LISTENER_TTL_MS;
  return {
    listener: listening ? "listening" : claimed ? "busy" : "offline",
    lastSeen,
    listenerClient: listener ? (listener.client ?? "cli") : null,
    editorOpen: editor !== null && now - editor.lastSeen < EDITOR_TTL_MS,
    pending,
    project: synced ? { id: synced.project.id, name: synced.project.name, syncedAt: synced.syncedAt } : null,
  };
}

// ---------------------------------------------------------------------------
// Events (Claude → editor)
// ---------------------------------------------------------------------------

/** An event before the store assigns its id and timestamp. */
export type NewBridgeEvent =
  | Omit<Extract<BridgeEvent, { type: "project" }>, "id" | "at">
  | Omit<Extract<BridgeEvent, { type: "edit" }>, "id" | "at">
  | Omit<Extract<BridgeEvent, { type: "board" }>, "id" | "at">;

export async function pushEvent(event: NewBridgeEvent, now = new Date()): Promise<BridgeEvent> {
  const full = { ...event, id: newBridgeId(now.getTime()), at: now.toISOString() } as BridgeEvent;
  await writeJsonAtomic(path.join(eventsDir(), `${full.id}.json`), full);
  const ids = await listIds(eventsDir());
  for (const old of ids.slice(0, Math.max(0, ids.length - MAX_EVENTS))) {
    await rm(path.join(eventsDir(), `${old}.json`), { force: true });
  }
  return full;
}

/**
 * Events after `cursor`. Without a cursor nothing is returned, only the
 * current cursor, so an editor that just opened does not replay old scenes.
 */
/** One stored event (the editor opened with ?event=<id> applies it on load). */
export function readEvent(id: string): Promise<BridgeEvent | null> {
  if (!isValidBridgeId(id)) return Promise.resolve(null);
  return readJson<BridgeEvent>(path.join(eventsDir(), `${id}.json`));
}

export async function eventsAfter(cursor: string | null): Promise<{ events: BridgeEvent[]; cursor: string }> {
  const ids = await listIds(eventsDir());
  const latest = ids.at(-1) ?? "";
  if (cursor === null) return { events: [], cursor: latest };
  const events: BridgeEvent[] = [];
  for (const id of ids) {
    if (id <= cursor) continue;
    const event = await readJson<BridgeEvent>(path.join(eventsDir(), `${id}.json`));
    if (event) events.push(event);
  }
  const newest = events.at(-1)?.id;
  return { events, cursor: newest ?? (cursor > latest ? cursor : latest) };
}

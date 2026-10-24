/**
 * Storyboard boards (docs/STORYBOARD.md). Every new video is made in steps the
 * designer sees in the editor:
 *
 *   1. Claude proposes style frames: one key frame of the video per direction;
 *   2. the designer picks one (and may add a note, or ask for other styles);
 *   3. Claude writes a storyboard in that style: shots with timing, action,
 *      on-screen text, sound cues and optional sketches;
 *   4. the designer approves it (or asks for changes), and only then Claude
 *      builds the video (`pushNewScene` with the board id).
 *
 * Each step the designer takes in the editor queues a bridge request with a
 * `board` field for whoever listens (a Code session, the chat connector, the
 * autopilot); the board update Claude sends back finishes it. When the
 * designer decides in the chat instead, Claude records the decision itself
 * (`fromClaude`) and nothing is queued.
 *
 *   boards/<id>.json   one Board (src/lib/types.ts)
 *   refs/<id>/         its reference images and videos (references.ts)
 */

import { rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { finalizeOutput } from "@/lib/ai";
import { SafeProjectPathSchema } from "@/lib/ai/schema";
import { createBlankProject } from "@/lib/importer";
import { parseScene } from "@/lib/parser";
import type { AiEditRequest, Board, BoardAction, BoardReference, BoardShot, BoardStyle, BoardSummary, StageMeta } from "@/lib/types";
import { MAX_REFERENCES, ReferenceUploadSchema, type ReferenceUpload, removeReferences, saveReference } from "./references";
import {
  type BoardRequestInfo,
  BridgeStateError,
  bridgeRoot,
  createRequest,
  finishRequest,
  isValidBridgeId,
  listIds,
  newBridgeId,
  pushEvent,
  readJson,
  readRequest,
  writeJsonAtomic,
} from "./store";

export const MAX_STYLES = 6;
export const MAX_SHOTS = 16;
/** Boards kept on disk; older ones are deleted when a new one is created. */
export const MAX_BOARDS = 40;
const MAX_BRIEF_CHARS = 8_000;
const MAX_NOTE_CHARS = 4_000;
const MAX_CODE_CHARS = 200_000;

const DEFAULT_META: StageMeta = { width: 1920, height: 1080, duration: 10, fps: 30, background: "#0b0b12" };

const boardsDir = () => path.join(bridgeRoot(), "boards");

function boardFile(id: string): string {
  if (!isValidBridgeId(id)) throw new BridgeStateError(`Invalid board id "${id}"`, 400);
  return path.join(boardsDir(), `${id}.json`);
}

/** A board update broke a rule; the message says what to fix (HTTP 422). */
export class BoardValidationError extends BridgeStateError {
  constructor(message: string) {
    super(message, 422);
    this.name = "BoardValidationError";
  }
}

// Read-modify-write of board files is serialised (the editor and Claude can act at the same moment).
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.catch(() => undefined).then(task);
  queue = next;
  return next;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export function readBoard(id: string): Promise<Board | null> {
  if (!isValidBridgeId(id)) return Promise.resolve(null);
  return readJson<Board>(boardFile(id));
}

async function requireBoard(id: string): Promise<Board> {
  const board = await readBoard(id);
  if (!board) throw new BridgeStateError(`Unknown board "${id}"`, 404);
  return board;
}

async function saveBoard(board: Board, now: Date): Promise<Board> {
  const saved = { ...board, updatedAt: now.toISOString() };
  await writeJsonAtomic(boardFile(board.id), saved);
  return saved;
}

/** Newest first. */
export async function listBoards(): Promise<BoardSummary[]> {
  const summaries: BoardSummary[] = [];
  for (const id of (await listIds(boardsDir())).reverse()) {
    const board = await readBoard(id);
    if (board) summaries.push({ id: board.id, title: board.title, status: board.status, updatedAt: board.updatedAt });
  }
  return summaries;
}

async function pruneBoards(): Promise<void> {
  const ids = await listIds(boardsDir());
  for (const old of ids.slice(0, Math.max(0, ids.length - MAX_BOARDS))) {
    await rm(path.join(boardsDir(), `${old}.json`), { force: true });
    await removeReferences(old);
  }
}

/** Save uploads as the board's next references (r1, r2, …), at most MAX_REFERENCES in all. */
async function addReferenceFiles(board: Board, uploads: ReferenceUpload[]): Promise<BoardReference[]> {
  const existing = board.references ?? [];
  if (existing.length + uploads.length > MAX_REFERENCES) {
    throw new BridgeStateError(`A storyboard takes at most ${MAX_REFERENCES} references`, 400);
  }
  const added: BoardReference[] = [];
  let next = existing.reduce((max, ref) => Math.max(max, Number(ref.id.slice(1)) || 0), 0);
  for (const upload of uploads) added.push(await saveReference(board.id, ++next, upload));
  return [...existing, ...added];
}

function newBoard(input: { title: string; brief: string; meta: StageMeta }, now: Date): Board {
  return {
    id: newBridgeId(now.getTime()),
    title: input.title,
    brief: input.brief,
    meta: input.meta,
    status: "styles-pending",
    styles: [],
    chosenStyleId: null,
    shots: [],
    storyboardNotes: "",
    stylesRevision: 0,
    storyboardRevision: 0,
    notes: [],
    references: [],
    projectId: null,
    waitingRequestId: null,
    lastError: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Schemas (bodies of the board routes)
// ---------------------------------------------------------------------------

const FileSchema = z.object({ path: SafeProjectPathSchema, content: z.string().max(MAX_CODE_CHARS) });

const StageInputSchema = z.object({
  width: z.number().int().min(16).max(4096).optional(),
  height: z.number().int().min(16).max(4096).optional(),
  duration: z.number().positive().max(600).optional(),
  fps: z.number().int().min(1).max(120).optional(),
  background: z.string().max(400).optional(),
});

/** POST /api/bridge/boards (Claude): style frames for a new board, or for an existing one (`boardId`). */
export const BoardStylesSchema = z.object({
  boardId: z.string().optional(),
  title: z.string().trim().min(1).max(120).optional(),
  brief: z.string().trim().min(1).max(MAX_BRIEF_CHARS).optional(),
  stage: StageInputSchema.optional(),
  styles: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        description: z.string().trim().max(400).default(""),
        code: z.string().min(1).max(MAX_CODE_CHARS),
        time: z.number().min(0).max(600).default(0),
        files: z.array(FileSchema).max(10).optional(),
      }),
    )
    .min(1)
    .max(MAX_STYLES),
});

/** POST /api/bridge/boards/[id]/storyboard (Claude). */
export const BoardStoryboardSchema = z.object({
  notes: z.string().trim().max(MAX_NOTE_CHARS).default(""),
  shots: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(120),
        start: z.number().min(0).max(600),
        end: z.number().min(0).max(600),
        action: z.string().trim().min(1).max(2_000),
        text: z.string().trim().max(1_000).optional(),
        audio: z.string().trim().max(400).optional(),
        code: z.string().min(1).max(MAX_CODE_CHARS).optional(),
        time: z.number().min(0).max(600).optional(),
        files: z.array(FileSchema).max(10).optional(),
      }),
    )
    .min(1)
    .max(MAX_SHOTS),
});

/** POST /api/bridge/boards/[id] (the designer in the editor, or Claude on the designer's word). */
export const BoardActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("choose-style"), styleId: z.string().min(1).max(10), note: z.string().trim().max(MAX_NOTE_CHARS).optional() }),
  z.object({ action: z.literal("restyle"), note: z.string().trim().max(MAX_NOTE_CHARS).optional() }),
  z.object({ action: z.literal("revise-storyboard"), note: z.string().trim().min(1).max(MAX_NOTE_CHARS) }),
  z.object({ action: z.literal("approve"), note: z.string().trim().max(MAX_NOTE_CHARS).optional() }),
]);

/** POST /api/bridge/boards/start (the editor's Ask Claude tab, scope "New scene"). */
export const BoardStartSchema = z.object({
  brief: z.string().trim().min(1).max(MAX_BRIEF_CHARS),
  stage: StageInputSchema.optional(),
  /** reference images / videos for the look */
  references: z.array(ReferenceUploadSchema).max(MAX_REFERENCES).optional(),
});

/** POST /api/bridge/boards/[id]/references (the editor): more references, e.g. before "Try other styles". */
export const BoardReferencesSchema = z.object({
  references: z.array(ReferenceUploadSchema).min(1).max(MAX_REFERENCES),
});

export type BoardStylesInput = z.infer<typeof BoardStylesSchema>;
export type BoardStoryboardInput = z.infer<typeof BoardStoryboardSchema>;
export type BoardActionInput = z.infer<typeof BoardActionSchema>;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function resolveMeta(input: z.infer<typeof StageInputSchema> | undefined, fallback: StageMeta): StageMeta {
  return {
    width: input?.width ?? fallback.width,
    height: input?.height ?? fallback.height,
    duration: input?.duration ?? fallback.duration,
    fps: input?.fps ?? fallback.fps,
    ...((input?.background ?? fallback.background) !== undefined ? { background: input?.background ?? fallback.background } : {}),
  };
}

/**
 * A style frame or shot sketch is a complete scene: it must pass the same checks as a new scene
 * and use the board's canvas size (so every frame shows what the final video will look like).
 */
function validateFrame(label: string, code: string, files: { path: string; content: string }[] | undefined, meta: StageMeta) {
  const request: AiEditRequest = { scope: "new", prompt: label, project: createBlankProject(meta, label) };
  const result = finalizeOutput(request, { summary: label, code, ...(files ? { files } : {}) });
  if (!result.ok) throw new BoardValidationError(`${label}: ${result.error}`);
  const sceneCode = result.sceneCode ?? code;
  const frameMeta = parseScene(sceneCode).meta;
  if (frameMeta.width !== meta.width || frameMeta.height !== meta.height) {
    throw new BoardValidationError(
      `${label} uses a ${frameMeta.width}x${frameMeta.height} stage, but the video is ${meta.width}x${meta.height}. Use the video's size.`,
    );
  }
  return { code: sceneCode, files: result.files, duration: frameMeta.duration };
}

function clampTime(time: number, duration: number): number {
  return Math.min(Math.max(0, time), Math.max(0, duration));
}

// ---------------------------------------------------------------------------
// Requests for Claude
// ---------------------------------------------------------------------------

/** The stage-sized blank project a board request carries (its `request` field is only for the queue's shape). */
function boardQueueRequest(board: Board, prompt: string): AiEditRequest {
  return { scope: "new", prompt: prompt.slice(0, 20_000) || board.title, project: createBlankProject(board.meta, board.title) };
}

async function queueStep(board: Board, info: BoardRequestInfo, now: Date): Promise<string> {
  const prompt = info.note ? `${info.action}: ${info.note}` : info.action === "new" ? board.brief : info.action;
  const record = await createRequest(boardQueueRequest(board, prompt), now, info);
  return record.id;
}

/** Finish the request Claude was answering with this board update (if any is still open). */
async function finishWaiting(board: Board): Promise<void> {
  if (!board.waitingRequestId) return;
  const record = await readRequest(board.waitingRequestId);
  if (record && (record.state === "pending" || record.state === "claimed")) {
    await finishRequest(record.id, { handled: true });
  }
}

/** Called when Claude declines a storyboard step: the board shows the reason. */
export function recordBoardDecline(boardId: string, reason: string, now = new Date()): Promise<void> {
  return serial(async () => {
    const board = await readBoard(boardId);
    if (!board) return;
    await saveBoard({ ...board, waitingRequestId: null, lastError: reason }, now);
  });
}

function summaryOf(board: Board): BoardSummary {
  return { id: board.id, title: board.title, status: board.status, updatedAt: board.updatedAt };
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** The designer asked for a new video in the editor: an empty board, and a request for style frames. */
export function startBoard(input: z.infer<typeof BoardStartSchema>, now = new Date()): Promise<Board> {
  return serial(async () => {
    const meta = resolveMeta(input.stage, DEFAULT_META);
    const title = input.brief.replace(/\s+/g, " ").trim().slice(0, 60);
    let board = newBoard({ title, brief: input.brief, meta }, now);
    if (input.references?.length) {
      try {
        board = { ...board, references: await addReferenceFiles(board, input.references) };
      } catch (error) {
        await removeReferences(board.id);
        throw error;
      }
    }
    const requestId = await queueStep(board, { boardId: board.id, action: "new" }, now);
    const saved = await saveBoard({ ...board, waitingRequestId: requestId }, now);
    await pruneBoards();
    return saved;
  });
}

/** The designer adds references to a board (they show in the next style step's brief). */
export function addBoardReferences(boardId: string, uploads: ReferenceUpload[], now = new Date()): Promise<Board> {
  return serial(async () => {
    const board = await requireBoard(boardId);
    if (board.status === "built") throw new BridgeStateError(`Board "${board.id}" is already built`, 409);
    return saveBoard({ ...board, references: await addReferenceFiles(board, uploads) }, now);
  });
}

/** Claude's style frames: a new board, or new styles for an existing one (step 1, or "try other styles"). */
export function proposeStyles(input: BoardStylesInput, now = new Date()): Promise<Board> {
  return serial(async () => {
    let board: Board;
    if (input.boardId) {
      board = await requireBoard(input.boardId);
      if (board.status !== "styles-pending" && board.status !== "choose-style") {
        throw new BridgeStateError(`Board "${board.id}" is past the style step (${board.status})`, 409);
      }
      if (input.title) board = { ...board, title: input.title };
      if (input.brief) board = { ...board, brief: input.brief };
      if (input.stage) board = { ...board, meta: resolveMeta(input.stage, board.meta) };
    } else {
      if (!input.title || !input.brief) throw new BoardValidationError("A new board needs a title and the brief");
      board = newBoard({ title: input.title, brief: input.brief, meta: resolveMeta(input.stage, DEFAULT_META) }, now);
      if (!input.stage) {
        // No stage given: the first style frame decides the canvas.
        try {
          const first = parseScene(input.styles[0].code).meta;
          board = { ...board, meta: { ...first } };
        } catch {
          // validateFrame reports the parse error below
        }
      }
    }
    const styles: BoardStyle[] = input.styles.map((style, index) => {
      const id = String.fromCharCode(97 + index);
      const label = `Style frame "${style.name}"`;
      const frame = validateFrame(label, style.code, style.files, board.meta);
      return {
        id,
        name: style.name,
        description: style.description,
        code: frame.code,
        ...(frame.files ? { files: frame.files } : {}),
        time: clampTime(style.time, frame.duration),
      };
    });
    await finishWaiting(board);
    const saved = await saveBoard(
      {
        ...board,
        styles,
        status: "choose-style",
        chosenStyleId: null,
        shots: [],
        storyboardNotes: "",
        stylesRevision: board.stylesRevision + 1,
        waitingRequestId: null,
        lastError: null,
      },
      now,
    );
    await pushEvent({ type: "board", boardId: saved.id, summary: `${styles.length} style frames for "${saved.title}"` }, now);
    if (!input.boardId) await pruneBoards();
    return saved;
  });
}

/** Claude's storyboard in the chosen style (step 3, or a revision). */
export function proposeStoryboard(boardId: string, input: BoardStoryboardInput, now = new Date()): Promise<Board> {
  return serial(async () => {
    const board = await requireBoard(boardId);
    if (board.status !== "storyboard-pending" && board.status !== "storyboard") {
      throw new BridgeStateError(
        board.status === "choose-style" || board.status === "styles-pending"
          ? `Board "${board.id}" has no chosen style yet: wait for the designer to pick one`
          : `Board "${board.id}" is past the storyboard step (${board.status})`,
        409,
      );
    }
    const errors: string[] = [];
    let previousEnd = 0;
    input.shots.forEach((shot, index) => {
      if (shot.end <= shot.start) errors.push(`shot ${index + 1} "${shot.title}" ends before it starts`);
      if (shot.end > board.meta.duration + 1e-6) {
        errors.push(`shot ${index + 1} "${shot.title}" ends at ${shot.end}s, after the video's ${board.meta.duration}s`);
      }
      if (shot.start + 1e-6 < previousEnd - 0.5) errors.push(`shot ${index + 1} "${shot.title}" overlaps the shot before it by more than 0.5s`);
      previousEnd = Math.max(previousEnd, shot.end);
    });
    if (errors.length) throw new BoardValidationError(`The storyboard does not fit the video: ${errors.join("; ")}`);
    const shots: BoardShot[] = input.shots.map((shot, index) => {
      const base: BoardShot = {
        id: `s${index + 1}`,
        title: shot.title,
        start: shot.start,
        end: shot.end,
        action: shot.action,
        ...(shot.text ? { text: shot.text } : {}),
        ...(shot.audio ? { audio: shot.audio } : {}),
      };
      if (!shot.code) return base;
      const frame = validateFrame(`Sketch of shot ${index + 1} "${shot.title}"`, shot.code, shot.files, board.meta);
      return {
        ...base,
        code: frame.code,
        ...(frame.files ? { files: frame.files } : {}),
        time: clampTime(shot.time ?? 0, frame.duration),
      };
    });
    await finishWaiting(board);
    const saved = await saveBoard(
      {
        ...board,
        shots,
        storyboardNotes: input.notes,
        status: "storyboard",
        storyboardRevision: board.storyboardRevision + 1,
        waitingRequestId: null,
        lastError: null,
      },
      now,
    );
    await pushEvent({ type: "board", boardId: saved.id, summary: `Storyboard for "${saved.title}" (${shots.length} shots)` }, now);
    return saved;
  });
}

/**
 * Which steps each decision can be taken from. Until the video is built the designer can go back
 * (pick another style, ask for other styles or a revised storyboard), and a step Claude declined
 * can be asked for again (e.g. "approve" while the build is pending).
 */
const ACTION_FROM: Record<Exclude<BoardAction, "new">, Board["status"][]> = {
  "choose-style": ["choose-style", "storyboard-pending", "storyboard", "build-pending"],
  restyle: ["styles-pending", "choose-style", "storyboard-pending", "storyboard", "build-pending"],
  "revise-storyboard": ["storyboard", "build-pending"],
  approve: ["storyboard", "build-pending"],
};

/**
 * The designer's decision. From the editor it queues the next step for Claude; with
 * `fromClaude` (the designer decided in the chat and Claude records it) nothing is queued.
 */
export function boardAction(boardId: string, input: BoardActionInput, opts: { fromClaude?: boolean; now?: Date } = {}): Promise<Board> {
  const now = opts.now ?? new Date();
  return serial(async () => {
    const board = await requireBoard(boardId);
    if (!ACTION_FROM[input.action].includes(board.status)) {
      throw new BridgeStateError(`Board "${board.id}" is at "${board.status}"; "${input.action}" is not possible now`, 409);
    }
    let next: Board = { ...board, lastError: null };
    const note = input.note?.trim() || undefined;
    switch (input.action) {
      case "choose-style":
        if (!board.styles.some((style) => style.id === input.styleId)) {
          throw new BridgeStateError(`Board "${board.id}" has no style "${input.styleId}"`, 400);
        }
        next = { ...next, chosenStyleId: input.styleId, status: "storyboard-pending", shots: [], storyboardNotes: "" };
        break;
      case "restyle":
        next = { ...next, status: "styles-pending", chosenStyleId: null };
        break;
      case "revise-storyboard":
        next = { ...next, status: "storyboard-pending" };
        break;
      case "approve":
        next = { ...next, status: "build-pending" };
        break;
    }
    if (note) {
      const stage = input.action === "approve" ? "build" : input.action === "choose-style" || input.action === "restyle" ? "styles" : "storyboard";
      next = { ...next, notes: [...next.notes, { at: now.toISOString(), stage, text: note }] };
    }
    // A step the editor queued earlier and nobody answered is replaced by this one.
    if (board.waitingRequestId) {
      const old = await readRequest(board.waitingRequestId);
      if (old && (old.state === "pending" || old.state === "claimed")) await finishRequest(old.id, { cancelled: true });
      next = { ...next, waitingRequestId: null };
    }
    if (!opts.fromClaude) {
      next = { ...next, waitingRequestId: await queueStep(next, { boardId: board.id, action: input.action, ...(note ? { note } : {}) }, now) };
    }
    return saveBoard(next, now);
  });
}

/**
 * Before a new scene is made from a board: the board must be approved (or Claude records the
 * designer's approval from the chat first). Returns the board to mark built afterwards.
 */
export async function boardForBuild(boardId: string): Promise<Board> {
  const board = await requireBoard(boardId);
  if (board.status !== "build-pending" && board.status !== "built") {
    throw new BridgeStateError(
      `Board "${board.id}" is at "${board.status}": the designer has not approved the storyboard yet. ` +
        "Show it to them and build only after they approve it in the editor (or tell you so in the chat: then record it with the approve action first).",
      409,
    );
  }
  return board;
}

export function markBoardBuilt(boardId: string, projectId: string, now = new Date()): Promise<BoardSummary | null> {
  return serial(async () => {
    const board = await readBoard(boardId);
    if (!board) return null;
    await finishWaiting(board);
    const saved = await saveBoard({ ...board, status: "built", projectId, waitingRequestId: null, lastError: null }, now);
    return summaryOf(saved);
  });
}

/**
 * Storyboard boards (docs/STORYBOARD.md): the whole flow against a temporary
 * bridge folder — the editor starts a board, Claude proposes style frames, the
 * designer picks one, Claude writes the storyboard, the designer approves and
 * the video is built — plus the rules that keep the steps in order.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GOOD_SCENE_CODE } from "@/lib/ai/__tests__/fixture";
import {
  BridgeStateError,
  boardAction,
  buildBoardBrief,
  claimNextRequest,
  completeRequest,
  eventsAfter,
  listBoards,
  proposeStoryboard,
  proposeStyles,
  pushNewScene,
  readBoard,
  readRequest,
  startBoard,
} from "..";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "motion-studio-boards-test-"));
  process.env.MOTION_STUDIO_BRIDGE_DIR = root;
});

afterAll(async () => {
  delete process.env.MOTION_STUDIO_BRIDGE_DIR;
  await rm(root, { recursive: true, force: true });
});

const STAGE = { width: 1280, height: 720, duration: 8, fps: 30 };

const styles = (names: string[]) => names.map((name, i) => ({ name, description: `${name} look`, time: 1 + i, code: GOOD_SCENE_CODE }));

const shots = [
  { title: "Open", start: 0, end: 3, action: "Logo fades in", text: "Hello", audio: "whoosh" },
  { title: "Close", start: 3, end: 8, action: "Title holds", code: GOOD_SCENE_CODE, time: 2 },
];

async function expectStatus(promise: Promise<unknown>, status: number) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(BridgeStateError);
  expect((error as BridgeStateError).status).toBe(status);
}

describe("storyboard flow from the editor", () => {
  it("goes style frames → choice → storyboard → approval → video", async () => {
    // 1. The designer asks for a new video in the editor.
    const started = await startBoard({ brief: "A teaser for our cafe", stage: STAGE });
    expect(started.status).toBe("styles-pending");
    expect(started.meta).toMatchObject(STAGE);

    const step1 = await claimNextRequest(new Date(), "cli");
    expect(step1?.board).toEqual({ boardId: started.id, action: "new" });
    const brief1 = buildBoardBrief(step1!, started, "cli");
    expect(brief1).toContain(`board-styles .motion-bridge/boards/${started.id}/styles.json --board ${started.id}`);
    expect(brief1).toContain("A teaser for our cafe");

    // 2. Claude proposes style frames for that board; the step is finished and the editor is told.
    const { cursor } = await eventsAfter(null);
    const withStyles = await proposeStyles({ boardId: started.id, styles: styles(["Bold", "Soft", "Retro"]) });
    expect(withStyles.status).toBe("choose-style");
    expect(withStyles.styles.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(withStyles.styles[0].code).toContain("data-layer-id"); // validated and given ids
    expect((await readRequest(step1!.id))?.state).toBe("done");
    const events = await eventsAfter(cursor);
    expect(events.events.map((e) => e.type)).toEqual(["board"]);

    // 3. The designer picks style b with a note: a storyboard step is queued.
    const chosen = await boardAction(started.id, { action: "choose-style", styleId: "b", note: "use our blue" });
    expect(chosen).toMatchObject({ status: "storyboard-pending", chosenStyleId: "b" });
    expect(chosen.notes.map((n) => n.text)).toEqual(["use our blue"]);
    const step2 = await claimNextRequest(new Date(), "mcp");
    expect(step2?.board).toMatchObject({ action: "choose-style", note: "use our blue" });
    const brief2 = buildBoardBrief(step2!, chosen, "mcp");
    expect(brief2).toContain("propose_storyboard");
    expect(brief2).toContain('Chosen style: "Soft"');

    // 4. Claude writes the storyboard; sketches are validated too.
    const boarded = await proposeStoryboard(started.id, { notes: "calm piano", shots });
    expect(boarded.status).toBe("storyboard");
    expect(boarded.shots.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(boarded.shots[1].code).toContain("<Stage");
    expect((await readRequest(step2!.id))?.state).toBe("done");

    // Building before the approval is refused.
    const early = await pushNewScene({ type: "project", name: "Cafe", summary: "s", code: GOOD_SCENE_CODE, boardId: started.id });
    expect(early).toMatchObject({ ok: false, status: 409 });

    // 5. Approval, then the build marks the board built and tags the project event.
    await boardAction(started.id, { action: "approve" });
    const step3 = await claimNextRequest(new Date(), "headless");
    expect(step3?.board?.action).toBe("approve");
    expect(buildBoardBrief(step3!, (await readBoard(started.id))!, "headless")).toContain('{"summary": "...", "code"');
    const built = await pushNewScene({ type: "project", name: "Cafe", summary: "Made it", code: GOOD_SCENE_CODE, boardId: started.id });
    expect(built.ok).toBe(true);
    if (!built.ok || built.event.type !== "project") throw new Error("expected a project event");
    expect(built.event.boardId).toBe(started.id);
    const final = await readBoard(started.id);
    expect(final).toMatchObject({ status: "built", projectId: built.event.project.id, waitingRequestId: null });
    expect((await readRequest(step3!.id))?.state).toBe("done");
  });
});

describe("storyboard rules", () => {
  it("starts a board straight from Claude's style frames, sized by the first frame", async () => {
    const board = await proposeStyles({ title: "Teaser", brief: "Cafe teaser", styles: styles(["A", "B"]) });
    expect(board).toMatchObject({ status: "choose-style", title: "Teaser", waitingRequestId: null });
    expect(board.meta).toMatchObject({ width: 1280, height: 720, duration: 8 });
    expect((await listBoards()).map((b) => b.id)).toEqual([board.id]);
  });

  it("needs a title and brief for a new board, and frames at the video's size", async () => {
    await expectStatus(proposeStyles({ styles: styles(["A"]) }), 422);
    await expectStatus(proposeStyles({ title: "T", brief: "b", stage: { width: 1080, height: 1920 }, styles: styles(["A"]) }), 422);
    await expectStatus(proposeStyles({ title: "T", brief: "b", styles: [{ name: "Broken", description: "", time: 0, code: "nope(" }] }), 422);
  });

  it("keeps the steps in order", async () => {
    const board = await proposeStyles({ title: "T", brief: "b", styles: styles(["A", "B"]) });
    await expectStatus(proposeStoryboard(board.id, { notes: "", shots }), 409); // no style chosen yet
    await expectStatus(boardAction(board.id, { action: "approve" }), 409);
    await expectStatus(boardAction(board.id, { action: "choose-style", styleId: "z" }), 400);
    await boardAction(board.id, { action: "choose-style", styleId: "a" }, { fromClaude: true });
    await expectStatus(
      proposeStoryboard(board.id, { notes: "", shots: [{ title: "Too long", start: 0, end: 20, action: "x" }] }),
      422,
    );
  });

  it("records decisions told in the chat without queuing a step", async () => {
    const board = await proposeStyles({ title: "T", brief: "b", styles: styles(["A", "B"]) });
    const chosen = await boardAction(board.id, { action: "choose-style", styleId: "a" }, { fromClaude: true });
    expect(chosen.waitingRequestId).toBeNull();
    expect(await claimNextRequest(new Date(), "cli")).toBeNull();
  });

  it("a new decision replaces the step nobody answered yet", async () => {
    const board = await proposeStyles({ title: "T", brief: "b", styles: styles(["A", "B"]) });
    const first = await boardAction(board.id, { action: "choose-style", styleId: "a" });
    const second = await boardAction(board.id, { action: "choose-style", styleId: "b" });
    expect((await readRequest(first.waitingRequestId!))?.state).toBe("cancelled");
    const claimed = await claimNextRequest(new Date(), "cli");
    expect(claimed?.id).toBe(second.waitingRequestId);
  });

  it("shows Claude's refusal on the board and refuses answers that are not board updates", async () => {
    const board = await startBoard({ brief: "Write my essay", stage: STAGE });
    const step = (await claimNextRequest(new Date(), "cli"))!;
    const wrong = await completeRequest(step, { summary: "s", code: GOOD_SCENE_CODE });
    expect(wrong).toMatchObject({ ok: false, code: "bad_request" });
    const declined = await completeRequest(step, { error: "That is not an animation" });
    expect(declined).toMatchObject({ ok: false, code: "declined" });
    expect(await readBoard(board.id)).toMatchObject({ lastError: "That is not an animation", waitingRequestId: null });
  });
});

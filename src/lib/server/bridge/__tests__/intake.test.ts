/**
 * The New video wizard's conversation (docs/STORYBOARD.md): each designer turn is a request only
 * the autopilot claims; its JSON reply finishes the request with the next question or the order.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeRequest } from "@/lib/ai/__tests__/fixture";
import { IntakeReplySchema, answerIntakeTurn, buildIntakeBrief, claimNextRequest, createRequest, readRequest, startIntakeTurn, toView } from "..";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "motion-studio-intake-test-"));
  process.env.MOTION_STUDIO_BRIDGE_DIR = root;
});

afterAll(async () => {
  delete process.env.MOTION_STUDIO_BRIDGE_DIR;
  await rm(root, { recursive: true, force: true });
});

const CONVERSATION = [
  { role: "claude" as const, text: "سلام! ویدیو برای کیه؟" },
  { role: "designer" as const, text: "برای پیج خودم، درباره Sora 2، یه ریل ۲۰ ثانیه‌ای" },
];

const ORDER = {
  kind: "footage" as const,
  brief: "ریل ۲۰ ثانیه‌ای درباره Sora 2 برای پیج شخصی",
  format: "9:16" as const,
  duration: 20,
  language: "Persian",
  script: "Sora 2 رایگان شد\nدنبال کن",
  styleHints: ["Social captions"],
};

describe("conversation turns", () => {
  it("are taken by the autopilot only; chat sessions get the other requests", async () => {
    const turn = await startIntakeTurn(CONVERSATION);
    const edit = await createRequest(makeRequest({ prompt: "make it blue" }));
    expect((await claimNextRequest(new Date(), "cli"))?.id).toBe(edit.id);
    expect(await claimNextRequest(new Date(), "mcp")).toBeNull();
    expect((await claimNextRequest(new Date(), "headless"))?.id).toBe(turn.id);
  });

  it("give Claude the conversation below the untrusted-text line, and how to reply", async () => {
    const turn = await startIntakeTurn(CONVERSATION);
    const brief = buildIntakeBrief(turn);
    expect(brief).toContain('{"reply": "<your message>", "done": false}');
    expect(brief).toContain('"format": "9:16" | "16:9" | "1:1" | "4:5"');
    expect(brief).toContain("Social captions");
    expect(brief).toContain("(you have asked 1)");
    expect(brief.indexOf("## About the text below")).toBeLessThan(brief.indexOf("برای پیج خودم"));
  });

  it("finish with Claude's reply, which the editor reads from the request", async () => {
    const turn = await startIntakeTurn(CONVERSATION);
    await claimNextRequest(new Date(), "headless");
    await answerIntakeTurn(turn.id, { reply: "سفارش آماده است", done: true, order: ORDER });
    const view = toView((await readRequest(turn.id))!);
    expect(view).toMatchObject({ state: "done", intakeResult: { reply: "سفارش آماده است", done: true, order: ORDER } });
    await expect(answerIntakeTurn(turn.id, { reply: "again", done: false })).rejects.toMatchObject({ status: 409 });
  });

  it("refuse a finished reply without an order", () => {
    expect(IntakeReplySchema.safeParse({ reply: "done", done: true }).success).toBe(false);
    expect(IntakeReplySchema.safeParse({ reply: "Who is it for?", done: false }).success).toBe(true);
    expect(IntakeReplySchema.safeParse({ reply: "ok", done: true, order: { ...ORDER, format: "4:3" } }).success).toBe(false);
  });
});

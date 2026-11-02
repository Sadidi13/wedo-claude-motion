import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeRequest } from "@/lib/ai/__tests__/fixture";
import { claimNextRequest, createRequest, readRequest, releaseClaims, startBoard } from "..";
import {
  type AutopilotStateFile,
  STOPPED_REASON,
  WORKING_TTL_MS,
  autopilotEnv,
  autopilotLogTail,
  describeAutopilot,
  stopAutopilot,
} from "../autopilot";
import { readBoard } from "../boards";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "motion-studio-autopilot-test-"));
  process.env.MOTION_STUDIO_BRIDGE_DIR = root;
});

afterAll(async () => {
  delete process.env.MOTION_STUDIO_BRIDGE_DIR;
  await rm(root, { recursive: true, force: true });
});

const NOW = 1_800_000_000_000;

function file(state: AutopilotStateFile["state"], extra: Partial<AutopilotStateFile> = {}): AutopilotStateFile {
  return { pid: 4242, state, model: "claude-opus-5-5", effort: { deep: "xhigh", normal: "high" }, startedAt: "2026-11-02T10:00:00.000Z", updatedAt: NOW, ...extra };
}

describe("describeAutopilot", () => {
  it("is stopped without a state file", () => {
    expect(describeAutopilot(null, false, NOW)).toMatchObject({ running: false, state: "stopped", model: null, effort: null });
  });

  it("passes a live state through with its model and efforts", () => {
    expect(describeAutopilot(file("listening"), true, NOW)).toEqual({
      running: true,
      state: "listening",
      message: null,
      model: "claude-opus-5-5",
      effort: { deep: "xhigh", normal: "high" },
      startedAt: "2026-11-02T10:00:00.000Z",
    });
  });

  it("counts a process that died without saying so as stopped", () => {
    expect(describeAutopilot(file("working", { message: "Request: x" }), false, NOW)).toMatchObject({ running: false, state: "stopped", message: null });
  });

  it("keeps why it ended (signed out, error)", () => {
    expect(describeAutopilot(file("signed-out", { message: "Claude Code is not signed in" }), false, NOW)).toMatchObject({
      running: false,
      state: "signed-out",
      message: "Claude Code is not signed in",
    });
    expect(describeAutopilot(file("error", { message: "boom" }), true, NOW)).toMatchObject({ running: false, state: "error" });
  });

  it("treats a working state without a recent heartbeat as listening", () => {
    expect(describeAutopilot(file("working", { updatedAt: NOW - WORKING_TTL_MS + 1 }), true, NOW).state).toBe("working");
    expect(describeAutopilot(file("working", { updatedAt: NOW - WORKING_TTL_MS - 1 }), true, NOW).state).toBe("listening");
  });
});

describe("autopilotEnv", () => {
  it("drops what belongs to Next.js and marks the run as managed", () => {
    const env = autopilotEnv({ PATH: "/bin", NODE_OPTIONS: "--inspect", __NEXT_PRIVATE_X: "1", NEXT_PRIVATE_WORKER: "1", MY_VAR: "kept" }, "/state");
    expect(env).toEqual({ PATH: "/bin", MY_VAR: "kept", MOTION_STUDIO_BRIDGE_DIR: "/state", MOTION_STUDIO_AUTOPILOT_MANAGED: "1" });
  });
});

describe("autopilotLogTail", () => {
  it("returns the last non-empty lines, or nothing without a log", async () => {
    expect(await autopilotLogTail()).toEqual([]);
    await writeFile(path.join(root, "autopilot.log"), "one\r\n\r\ntwo\nthree\n", "utf8");
    expect(await autopilotLogTail(2)).toEqual(["two", "three"]);
  });
});

describe("releaseClaims", () => {
  it("declines only what the autopilot claimed", async () => {
    const mine = await createRequest(makeRequest({ prompt: "make it blue" }));
    await claimNextRequest(new Date(), "headless");
    const theirs = await createRequest(makeRequest({ prompt: "make it red" }));
    await claimNextRequest(new Date(), "cli");
    const waiting = await createRequest(makeRequest({ prompt: "later" }));

    expect(await releaseClaims("headless", "stopped")).toBe(1);
    expect(await readRequest(mine.id)).toMatchObject({ state: "error", error: "stopped", claimedBy: "headless" });
    expect((await readRequest(theirs.id))?.state).toBe("claimed");
    expect((await readRequest(waiting.id))?.state).toBe("pending");
  });

  it("shows the reason on a storyboard step the autopilot was working on", async () => {
    const board = await startBoard({ brief: "A 10 second teaser for a coffee brand", references: [] });
    await claimNextRequest(new Date(), "headless");
    await stopAutopilot();
    const after = await readBoard(board.id);
    expect(after?.lastError).toBe(STOPPED_REASON);
    expect(after?.waitingRequestId).toBeNull();
    expect((await readRequest(board.waitingRequestId!))?.state).toBe("error");
  });
});

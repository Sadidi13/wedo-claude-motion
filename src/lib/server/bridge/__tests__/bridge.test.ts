import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GOOD_LAYER_CODE, GOOD_SCENE_CODE, makeProject, makeRequest } from "@/lib/ai/__tests__/fixture";
import {
  BridgeStateError,
  bridgeStatus,
  bridgeToken,
  buildBrief,
  claimNextRequest,
  completeRequest,
  createRequest,
  eventsAfter,
  finishRequest,
  isValidBridgeId,
  isValidToken,
  pushEdit,
  pushNewScene,
  readRequest,
  syncProject,
  toView,
} from "..";
import { LISTENER_TTL_MS, newBridgeId } from "../store";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "motion-studio-bridge-test-"));
  process.env.MOTION_STUDIO_BRIDGE_DIR = root;
});

afterAll(async () => {
  delete process.env.MOTION_STUDIO_BRIDGE_DIR;
  await rm(root, { recursive: true, force: true });
});

describe("ids", () => {
  it("are valid and strictly increasing even within one millisecond", () => {
    const ids = [newBridgeId(1_000), newBridgeId(1_000), newBridgeId(999)];
    expect(ids.every(isValidBridgeId)).toBe(true);
    expect([...ids].sort()).toEqual(ids);
  });
});

describe("token", () => {
  it("is created once and checked exactly", async () => {
    const token = await bridgeToken();
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect(await bridgeToken()).toBe(token);
    expect((await readFile(path.join(root, "token"), "utf8")).trim()).toBe(token);
    expect(await isValidToken(token)).toBe(true);
    expect(await isValidToken(`${token}x`)).toBe(false);
    expect(await isValidToken(null)).toBe(false);
  });
});

describe("requests", () => {
  it("queue, claim oldest first, and finish once", async () => {
    const first = await createRequest(makeRequest({ prompt: "first" }));
    const second = await createRequest(makeRequest({ prompt: "second" }));
    expect((await bridgeStatus()).pending).toBe(2);

    const claimed = await claimNextRequest();
    expect(claimed?.id).toBe(first.id);
    expect(claimed?.state).toBe("claimed");
    expect((await bridgeStatus()).listener).toBe("listening");

    await finishRequest(first.id, { error: "nope" });
    await expect(finishRequest(first.id, { error: "again" })).rejects.toBeInstanceOf(BridgeStateError);

    await finishRequest(second.id, { cancelled: true });
    expect((await readRequest(second.id))?.state).toBe("cancelled");
    expect(await claimNextRequest()).toBeNull();
  });

  it("views never echo the request body", async () => {
    const record = await createRequest(makeRequest());
    expect(toView(record)).not.toHaveProperty("request");
  });

  it("reports busy when nobody polls but a request is claimed", async () => {
    await createRequest(makeRequest());
    await claimNextRequest(new Date(1_000_000));
    const status = await bridgeStatus(1_000_000 + LISTENER_TTL_MS + 1);
    expect(status.listener).toBe("busy");
  });

  it("validates answers like the API path and keeps invalid ones claimed", async () => {
    const record = await createRequest(makeRequest({ scope: "layer", layerId: "title" }));
    const claimed = (await claimNextRequest())!;

    const bad = await completeRequest(claimed, { summary: "x", code: "<div>unclosed" });
    expect(bad.ok).toBe(false);
    expect((await readRequest(record.id))?.state).toBe("claimed");

    const good = await completeRequest(claimed, { summary: "Title fades in", code: GOOD_LAYER_CODE });
    expect(good.ok).toBe(true);
    const done = await readRequest(record.id);
    expect(done?.state).toBe("done");
    expect(done?.result?.layerCode).toContain('data-layer-id="title"');
  });

  it("builds a brief with the instruction, the source and how to answer", async () => {
    const record = await createRequest(makeRequest({ scope: "layer", layerId: "title", prompt: "عنوان قرمز شود" }));
    const brief = buildBrief(record);
    expect(brief).toContain(`# Motion Studio request ${record.id}`);
    expect(brief).toContain("عنوان قرمز شود");
    expect(brief).toContain("# Selected layer");
    expect(brief).toContain(`respond ${record.id}`);
  });
});

describe("events", () => {
  it("start from the current cursor and then deliver in order", async () => {
    expect(await eventsAfter(null)).toEqual({ events: [], cursor: "" });

    const created = await pushNewScene({ type: "project", name: "Teaser", summary: "A teaser", code: GOOD_SCENE_CODE });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.event.type).toBe("project");

    const fromStart = await eventsAfter("");
    expect(fromStart.events.map((e) => e.id)).toEqual([created.event.id]);
    expect(await eventsAfter(fromStart.cursor)).toEqual({ events: [], cursor: fromStart.cursor });

    const opened = await eventsAfter(null);
    expect(opened.events).toEqual([]);
    expect(opened.cursor).toBe(created.event.id);
  });

  it("new scenes become projects whose meta comes from the Stage", async () => {
    const created = await pushNewScene({ type: "project", name: "Teaser", summary: "s", code: GOOD_SCENE_CODE });
    if (!created.ok || created.event.type !== "project") throw new Error("expected a project event");
    const project = created.event.project;
    expect(project.name).toBe("Teaser");
    expect(project.origin).toBe("ai-generate");
    expect(project.files[project.entry]?.content).toContain("<Stage");
  });

  it("rejects scene code that fails validation", async () => {
    const result = await pushNewScene({ type: "project", name: "Bad", summary: "s", code: "export default function A() { return <div/>; }" });
    expect(result.ok).toBe(false);
  });

  it("edits need a shared project and target its id", async () => {
    const before = await pushEdit({ type: "edit", prompt: "", summary: "s", code: GOOD_SCENE_CODE });
    expect(before).toMatchObject({ ok: false, status: 409 });

    await syncProject(makeProject());
    const edited = await pushEdit({ type: "edit", prompt: "make it faster", summary: "Faster", code: GOOD_SCENE_CODE });
    if (!edited.ok || edited.event.type !== "edit") throw new Error("expected an edit event");
    expect(edited.event.projectId).toBe("p1");
    expect(edited.event.response.scope).toBe("scene");

    const layer = await pushEdit({ type: "edit", prompt: "", summary: "Title", code: GOOD_LAYER_CODE, layerId: "title" });
    if (!layer.ok || layer.event.type !== "edit") throw new Error("expected an edit event");
    expect(layer.event.response.scope).toBe("layer");
    expect(layer.event.layerId).toBe("title");
  });
});

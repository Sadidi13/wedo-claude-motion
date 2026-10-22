import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  JOB_ID_PATTERN,
  createJob,
  isValidJobId,
  jobDir,
  jobsRoot,
  readOptions,
  readProject,
  readStatus,
  writeStatus,
} from "../jobs";
import { ExportRequestError } from "../schema";
import { makeRequest } from "./fixtures";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "motion-studio-jobs-test-"));
  process.env.MOTION_STUDIO_JOBS_DIR = root;
});

afterAll(async () => {
  delete process.env.MOTION_STUDIO_JOBS_DIR;
  await rm(root, { recursive: true, force: true });
});

describe("job ids", () => {
  it("accepts lowercase alphanumerics of 10..24 chars", () => {
    expect(isValidJobId("abcdefghij")).toBe(true);
    expect(isValidJobId("a1b2c3d4e5f6g7h8i9j0k1l2")).toBe(true);
  });

  it("rejects traversal, separators, case and bad lengths", () => {
    for (const bad of ["", "short", "ABCDEFGHIJK", "../../../etc", "abc/def/ghij", "abcdefghij\n", "a".repeat(25), "abc def ghij", "..abcdefghij"]) {
      expect(isValidJobId(bad), bad).toBe(false);
      expect(() => jobDir(bad), bad).toThrow(/Invalid export job id/);
    }
  });

  it("resolves the directory under the jobs root", () => {
    expect(jobsRoot()).toBe(root);
    expect(jobDir("abcdefghij")).toBe(path.join(root, "abcdefghij"));
  });
});

describe("createJob", () => {
  it("writes project / options / status and returns a nanoid job id", async () => {
    const { jobId, dir } = await createJob(makeRequest({ format: "webm", transparent: true }));
    expect(jobId).toMatch(JOB_ID_PATTERN);
    expect(dir).toBe(jobDir(jobId));
    for (const file of ["project.json", "options.json", "status.json"]) expect(existsSync(path.join(dir, file)), file).toBe(true);

    const status = await readStatus(jobId);
    expect(status).toMatchObject({ jobId, state: "queued", progress: 0, framesDone: 0, framesTotal: 20 });
    expect(typeof status?.startedAt).toBe("string");
    expect((await readProject(jobId))?.name).toBe("Product Launch");
    expect(await readOptions(jobId)).toEqual({ format: "webm", transparent: true });
  });

  it("strips unknown keys and fills missing timestamps", async () => {
    const request = makeRequest();
    const loose = {
      ...request,
      project: { ...request.project, createdAt: undefined, updatedAt: undefined, extra: 1 },
      options: { ...request.options, bogus: true },
    };
    const { jobId } = await createJob(loose);
    const project = await readProject(jobId);
    expect(project).not.toHaveProperty("extra");
    expect(typeof project?.createdAt).toBe("string");
    expect(await readOptions(jobId)).toEqual({ format: "mp4" });
  });

  it("rejects malformed requests with ExportRequestError", async () => {
    const cases: Array<[string, unknown]> = [
      ["not an object", "nope"],
      ["missing options", { project: makeRequest().project }],
      ["bad format", makeRequest({ format: "avi" as never })],
      ["fps 0", makeRequest({ fps: 0 })],
      ["fps 121", makeRequest({ fps: 121 })],
      ["scale 3", makeRequest({ scale: 3 as never })],
      ["range start >= end", makeRequest({ range: { start: 1, end: 1 } })],
      ["negative range", makeRequest({ range: { start: -1, end: 1 } })],
      ["quality 52", makeRequest({ quality: 52 })],
      ["meta width 0", makeRequest({}, { meta: { width: 0, height: 180, duration: 2, fps: 10 } })],
      ["meta fps negative", makeRequest({}, { meta: { width: 320, height: 180, duration: 2, fps: -1 } })],
      ["entry not in files", makeRequest({}, { entry: "missing.jsx" })],
      ["empty id", makeRequest({}, { id: "" })],
    ];
    for (const [label, body] of cases) {
      await expect(createJob(body), label).rejects.toBeInstanceOf(ExportRequestError);
    }
  });

  it("rejects a range that is empty after clamping to the duration", async () => {
    await expect(createJob(makeRequest({ range: { start: 5, end: 6 } }))).rejects.toThrow(/empty/);
  });
});

describe("status", () => {
  it("returns null for unknown jobs and refuses to write them", async () => {
    expect(await readStatus("zzzzzzzzzzzz")).toBeNull();
    expect(await readProject("zzzzzzzzzzzz")).toBeNull();
    await expect(writeStatus("zzzzzzzzzzzz", { state: "done" })).rejects.toThrow(/does not exist/);
  });

  it("merges patches and never lets the jobId be overwritten", async () => {
    const { jobId } = await createJob(makeRequest());
    const updated = await writeStatus(jobId, { state: "rendering", framesDone: 3, progress: 0.15, jobId: "hacked" });
    expect(updated).toMatchObject({ jobId, state: "rendering", framesDone: 3, progress: 0.15, framesTotal: 20 });
    expect(await readStatus(jobId)).toEqual(updated);
  });

  it("serialises concurrent writes so the last patch wins and the file stays valid JSON", async () => {
    const { jobId, dir } = await createJob(makeRequest());
    await Promise.all(Array.from({ length: 25 }, (_, i) => writeStatus(jobId, { framesDone: i + 1 })));
    const raw = JSON.parse(await readFile(path.join(dir, "status.json"), "utf8"));
    expect(raw.framesDone).toBe(25);
    expect(raw.state).toBe("queued");
  });
});

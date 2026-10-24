/**
 * Polled JSON state files: writes land even while Windows refuses to rename over
 * a file a reader holds open, and readers retry a file caught half written.
 */
import { mkdtemp, open, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readJsonFile, writeJsonFile } from "../jsonFile";

const fault = vi.hoisted(() => ({ renameLocked: false, writeLocks: 0, tornReads: 0 }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  const locked = (syscall: string) => Object.assign(new Error(`EPERM: operation not permitted, ${syscall}`), { code: "EPERM" });
  return {
    ...real,
    rename: vi.fn(async (...args: Parameters<typeof real.rename>) => {
      if (fault.renameLocked) throw locked("rename");
      return real.rename(...args);
    }),
    writeFile: vi.fn(async (...args: Parameters<typeof real.writeFile>) => {
      if (fault.writeLocks > 0 && !String(args[0]).endsWith(".tmp")) {
        fault.writeLocks--;
        throw locked("open");
      }
      return real.writeFile(...args);
    }),
    readFile: vi.fn(async (...args: Parameters<typeof real.readFile>) => {
      if (fault.tornReads > 0) {
        fault.tornReads--;
        return '{"framesDone":';
      }
      return real.readFile(...args);
    }),
  };
});

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "motion-studio-jsonfile-test-"));
});

afterEach(() => {
  Object.assign(fault, { renameLocked: false, writeLocks: 0, tornReads: 0 });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const leftovers = async () => (await readdir(dir)).filter((name) => name.endsWith(".tmp"));

describe("writeJsonFile / readJsonFile", () => {
  it("round-trips a value, and reads a missing file as null", async () => {
    const file = path.join(dir, "plain.json");
    expect(await readJsonFile(file)).toBeNull();
    await writeJsonFile(file, { state: "queued", framesDone: 0 });
    await writeJsonFile(file, { state: "rendering", framesDone: 3 });
    expect(await readJsonFile(file)).toEqual({ state: "rendering", framesDone: 3 });
    expect(await leftovers()).toEqual([]);
  });

  it("writes while a reader keeps the file open (Windows refuses the rename then)", async () => {
    const file = path.join(dir, "held.json");
    await writeJsonFile(file, { framesDone: 1 });
    const reader = await open(file, "r");
    try {
      await writeJsonFile(file, { framesDone: 2 });
    } finally {
      await reader.close();
    }
    expect(await readJsonFile(file)).toEqual({ framesDone: 2 });
    expect(await leftovers()).toEqual([]);
  });

  it("falls back to writing in place when the rename stays locked, retrying a locked open", async () => {
    const file = path.join(dir, "locked.json");
    await writeJsonFile(file, { framesDone: 1 });
    fault.renameLocked = true;
    fault.writeLocks = 2;
    await writeJsonFile(file, { framesDone: 2, state: "rendering" });
    expect(fault.writeLocks).toBe(0);
    expect(await readJsonFile(file)).toEqual({ framesDone: 2, state: "rendering" });
    expect(await leftovers()).toEqual([]);
  });

  it("reads again when it catches a file half written", async () => {
    const file = path.join(dir, "torn.json");
    await writeJsonFile(file, { framesDone: 7 });
    fault.tornReads = 3;
    expect(await readJsonFile(file)).toEqual({ framesDone: 7 });
    expect(fault.tornReads).toBe(0);
  });

  it("gives up on a file that never parses, and passes other errors through", async () => {
    const file = path.join(dir, "broken.json");
    fault.tornReads = 1_000;
    await expect(readJsonFile(file)).rejects.toThrow(SyntaxError);
    fault.tornReads = 0;
    await expect(writeJsonFile(path.join(dir, "missing-folder", "x.json"), {})).rejects.toMatchObject({ code: "ENOENT" });
  });
});

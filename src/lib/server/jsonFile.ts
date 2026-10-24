/**
 * JSON state files that one side writes while another polls them: export job
 * status (export/jobs.ts) and the Claude bridge state (bridge/store.ts).
 *
 * A write goes to a temp file that is renamed over the target, so readers see
 * the old or the new content, never half of it. Windows refuses that rename
 * while any handle has the target open, and a busy poller (or a virus scanner)
 * can keep it open for seconds. After a short retry the write falls back to
 * rewriting the file in place, which Windows allows while others read it. A
 * reader can then catch the file half written, so `readJsonFile` reads again
 * when the text does not parse yet.
 */

import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

const LOCKED = new Set(["EPERM", "EBUSY", "EACCES"]);
/** Rename attempts before writing in place (backoff 5, 10, 15, … ms: about 0.1 s in all). */
const RENAME_ATTEMPTS = 6;
/** In-place writes can meet an exclusive lock too (a scanner); retried for about 2 s. */
const WRITE_ATTEMPTS = 40;
const WRITE_RETRY_MS = 50;
/** Reads of a file being rewritten in place: about 0.5 s of retries. */
const PARSE_ATTEMPTS = 25;
const PARSE_RETRY_MS = 20;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const codeOf = (error: unknown) => (error as NodeJS.ErrnoException)?.code ?? "";

/** The parsed file, or null when it does not exist. */
export async function readJsonFile<T>(file: string): Promise<T | null> {
  for (let attempt = 1; ; attempt++) {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if (codeOf(error) === "ENOENT") return null;
      if (!LOCKED.has(codeOf(error)) || attempt >= PARSE_ATTEMPTS) throw error;
      await sleep(PARSE_RETRY_MS);
      continue;
    }
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      // Half of an in-place write; the rest lands within milliseconds.
      if (attempt >= PARSE_ATTEMPTS) throw error;
      await sleep(PARSE_RETRY_MS);
    }
  }
}

/** Replace `file` with `value` as JSON (the folder must exist). */
export async function writeJsonFile(file: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value);
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, text, "utf8");
  try {
    for (let attempt = 1; attempt <= RENAME_ATTEMPTS; attempt++) {
      try {
        await rename(tmp, file);
        return;
      } catch (error) {
        if (!LOCKED.has(codeOf(error))) throw error;
        if (attempt < RENAME_ATTEMPTS) await sleep(5 * attempt);
      }
    }
    // Still locked by a reader: write through the open handles instead.
    for (let attempt = 1; ; attempt++) {
      try {
        await writeFile(file, text, "utf8");
        return;
      } catch (error) {
        if (!LOCKED.has(codeOf(error)) || attempt >= WRITE_ATTEMPTS) throw error;
        await sleep(WRITE_RETRY_MS);
      }
    }
  } finally {
    await rm(tmp, { force: true });
  }
}

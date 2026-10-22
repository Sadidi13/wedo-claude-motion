/**
 * Export job storage (CONTRACTS.md §6). One directory per job under
 * `os.tmpdir()/motion-studio/jobs/<jobId>/` (override: MOTION_STUDIO_JOBS_DIR):
 *
 *   project.json   the Project the preview page loads (`/api/export/<id>/project`)
 *   options.json   the ExportOptions the renderer + encoder read
 *   status.json    ExportJobStatus, polled by the editor
 *   frames/        rendered frames, removed after a successful encode
 *   output.<ext>   the encoded file served by `/download`
 *
 * Job ids are nanoid strings over [a-z0-9]; `jobDir` refuses anything else so a
 * request can never reach outside the jobs root. Status writes are atomic
 * (temp file + rename) and serialised per job so parallel render workers
 * cannot clobber each other's read-modify-write.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { customAlphabet } from "nanoid";
import type { ExportJobStatus, ExportOptions, Project } from "@/lib/types";
import { resolvePlan } from "./plan";
import { parseExportRequest } from "./schema";

export const JOB_ID_PATTERN = /^[a-z0-9]{10,24}$/;

const newJobId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 14);

export function isValidJobId(jobId: string): boolean {
  return JOB_ID_PATTERN.test(jobId);
}

export function jobsRoot(): string {
  return process.env.MOTION_STUDIO_JOBS_DIR || path.join(os.tmpdir(), "motion-studio", "jobs");
}

/** Absolute job directory. Throws for any id that does not match JOB_ID_PATTERN. */
export function jobDir(jobId: string): string {
  if (!isValidJobId(jobId)) throw new Error(`Invalid export job id "${jobId}"`);
  return path.join(jobsRoot(), jobId);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(value), "utf8");
  await rename(tmp, file);
}

/**
 * Validates the request (zod), allocates a job directory and writes
 * project.json / options.json / status.json (state "queued").
 * `request` is the raw JSON body; it is validated here, not by the caller.
 */
export async function createJob(request: unknown): Promise<{ jobId: string; dir: string }> {
  const { project, options } = parseExportRequest(request);
  const plan = resolvePlan(project, options); // throws early for an empty range
  const jobId = newJobId();
  const dir = jobDir(jobId);
  await mkdir(dir, { recursive: true });
  const status: ExportJobStatus = {
    jobId,
    state: "queued",
    progress: 0,
    framesDone: 0,
    framesTotal: plan.frameCount,
    startedAt: new Date().toISOString(),
  };
  await Promise.all([
    writeJsonAtomic(path.join(dir, "project.json"), project),
    writeJsonAtomic(path.join(dir, "options.json"), options),
    writeJsonAtomic(path.join(dir, "status.json"), status),
  ]);
  return { jobId, dir };
}

export function readStatus(jobId: string): Promise<ExportJobStatus | null> {
  return readJson<ExportJobStatus>(path.join(jobDir(jobId), "status.json"));
}

export function readProject(jobId: string): Promise<Project | null> {
  return readJson<Project>(path.join(jobDir(jobId), "project.json"));
}

export function readOptions(jobId: string): Promise<ExportOptions | null> {
  return readJson<ExportOptions>(path.join(jobDir(jobId), "options.json"));
}

// Per-job write queue: merges are read-modify-write, so they must not interleave.
const statusQueues = new Map<string, Promise<unknown>>();

/** Merges `patch` into status.json and returns the new status. Throws if the job does not exist. */
export function writeStatus(jobId: string, patch: Partial<ExportJobStatus>): Promise<ExportJobStatus> {
  const file = path.join(jobDir(jobId), "status.json");
  const previous = statusQueues.get(jobId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined) // a failed earlier write must not poison the queue
    .then(async () => {
      const current = await readJson<ExportJobStatus>(file);
      if (!current) throw new Error(`Export job "${jobId}" does not exist`);
      const merged: ExportJobStatus = { ...current, ...patch, jobId };
      await writeJsonAtomic(file, merged);
      return merged;
    });
  statusQueues.set(jobId, next);
  const forget = () => {
    if (statusQueues.get(jobId) === next) statusQueues.delete(jobId);
  };
  next.then(forget, forget); // the caller owns the rejection; this must not re-raise it
  return next;
}

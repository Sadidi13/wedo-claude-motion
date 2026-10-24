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
 * request can never reach outside the jobs root. Status writes go through
 * ../jsonFile.ts (temp file + rename, which survives Windows locking the file
 * during a status poll) and are serialised per job so parallel render workers
 * cannot clobber each other's read-modify-write.
 */

import { mkdir, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { customAlphabet } from "nanoid";
import type { ExportJobStatus, ExportOptions, Project } from "@/lib/types";
import { readJsonFile, writeJsonFile } from "../jsonFile";
import { resolvePlan } from "./plan";
import { EXPORT_LIMITS, ExportRequestError, parseExportRequest } from "./schema";

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

/**
 * Validates the request (zod), allocates a job directory and writes
 * project.json / options.json / status.json (state "queued").
 * `request` is the raw JSON body; it is validated here, not by the caller.
 */
export async function createJob(request: unknown): Promise<{ jobId: string; dir: string }> {
  const { project, options } = parseExportRequest(request);
  const plan = resolvePlan(project, options); // throws early for an empty range
  if (plan.frameCount > EXPORT_LIMITS.maxFrames) {
    throw new ExportRequestError(`This export would render ${plan.frameCount} frames; the limit is ${EXPORT_LIMITS.maxFrames}. Shorten the range or lower the fps.`);
  }
  await pruneOldJobs();
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
    writeJsonFile(path.join(dir, "project.json"), project),
    writeJsonFile(path.join(dir, "options.json"), options),
    writeJsonFile(path.join(dir, "status.json"), status),
  ]);
  return { jobId, dir };
}

/** Finished or abandoned jobs are deleted after this long (frames and outputs can be large). */
export const JOB_TTL_MS = 24 * 60 * 60_000;

/** Delete job folders older than JOB_TTL_MS. Best effort: a folder in use is skipped. */
export async function pruneOldJobs(now = Date.now()): Promise<number> {
  const entries = await readdir(jobsRoot()).catch(() => [] as string[]);
  let removed = 0;
  for (const name of entries) {
    if (!isValidJobId(name)) continue;
    const dir = path.join(jobsRoot(), name);
    const info = await stat(dir).catch(() => null);
    if (!info || now - info.mtimeMs < JOB_TTL_MS) continue;
    await rm(dir, { recursive: true, force: true }).then(() => removed++, () => undefined);
  }
  return removed;
}

export function readStatus(jobId: string): Promise<ExportJobStatus | null> {
  return readJsonFile<ExportJobStatus>(path.join(jobDir(jobId), "status.json"));
}

export function readProject(jobId: string): Promise<Project | null> {
  return readJsonFile<Project>(path.join(jobDir(jobId), "project.json"));
}

export function readOptions(jobId: string): Promise<ExportOptions | null> {
  return readJsonFile<ExportOptions>(path.join(jobDir(jobId), "options.json"));
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
      const current = await readJsonFile<ExportJobStatus>(file);
      if (!current) throw new Error(`Export job "${jobId}" does not exist`);
      const merged: ExportJobStatus = { ...current, ...patch, jobId };
      await writeJsonFile(file, merged);
      return merged;
    });
  statusQueues.set(jobId, next);
  const forget = () => {
    if (statusQueues.get(jobId) === next) statusQueues.delete(jobId);
  };
  next.then(forget, forget); // the caller owns the rejection; this must not re-raise it
  return next;
}

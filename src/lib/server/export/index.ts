/**
 * Export module (CONTRACTS.md §6) — public entry used by the /api/export routes.
 *
 * `startExport` validates + stores the job, answers immediately with the id and
 * runs render → encode in the background; every outcome (including a crash)
 * lands in status.json so the editor's polling always terminates. An in-process
 * set of running job ids guards against the same job being run twice.
 */

import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { encode } from "./ffmpeg";
import { createJob, jobDir, readOptions, readProject, readStatus, writeStatus } from "./jobs";
import { resolvePlan } from "./plan";
import { renderJob } from "./renderer";

export { isValidJobId, readProject, readStatus } from "./jobs";
export { ExportRequestError } from "./schema";

const running = new Set<string>();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Full pipeline for one stored job. Rejects up front if that job is already running. */
async function runExportJob(jobId: string, origin: string): Promise<void> {
  if (running.has(jobId)) throw new Error(`Export job "${jobId}" is already running`);
  running.add(jobId);
  try {
    const { plan, framesDir } = await renderJob(jobId, origin);
    await writeStatus(jobId, { state: "encoding" });
    await encode(jobDir(jobId), {
      format: plan.format,
      fps: plan.fps,
      transparent: plan.transparent,
      quality: plan.quality,
      width: plan.outputWidth,
      height: plan.outputHeight,
    });
    await rm(framesDir, { recursive: true, force: true });
    await writeStatus(jobId, {
      state: "done",
      progress: 1,
      downloadUrl: `/api/export/${jobId}/download`,
      fileName: plan.fileName,
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[export] job ${jobId} failed:`, error);
    await writeStatus(jobId, { state: "error", error: errorMessage(error), finishedAt: new Date().toISOString() }).catch(
      (statusError: unknown) => console.error(`[export] could not record failure of job ${jobId}:`, statusError),
    );
  } finally {
    running.delete(jobId);
  }
}

/**
 * Creates the job from a raw request body (throws `ExportRequestError` when
 * invalid), kicks off rendering in the background and returns the job id.
 * `origin` is where `/preview` is served (the incoming request's origin).
 */
export async function startExport(request: unknown, origin: string): Promise<string> {
  const { jobId } = await createJob(request);
  // Fire-and-forget: every pipeline failure is recorded in status.json; only the
  // duplicate-start guard can reject here, and it must not become an unhandled rejection.
  void runExportJob(jobId, origin).catch((error: unknown) => console.error(`[export] job ${jobId} not started:`, error));
  return jobId;
}

export interface DownloadInfo {
  path: string;
  size: number;
  fileName: string;
  contentType: string;
}

/** The finished deliverable of a job, or null when the job is unknown / not done yet. */
export async function resolveDownload(jobId: string): Promise<DownloadInfo | null> {
  const [status, project, options] = await Promise.all([readStatus(jobId), readProject(jobId), readOptions(jobId)]);
  if (!status || !project || !options || status.state !== "done") return null;
  const plan = resolvePlan(project, options);
  const file = path.join(jobDir(jobId), plan.outputFile);
  try {
    const info = await stat(file);
    return { path: file, size: info.size, fileName: plan.fileName, contentType: plan.contentType };
  } catch {
    return null;
  }
}

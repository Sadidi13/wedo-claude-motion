/**
 * POST /api/bridge/qa (CLI, token) — the quality check for Claude: of the scene
 * a pushed event created (`{ eventId }` of a new scene), or of the project open
 * in the editor (after an edit, `{ eventId }` waits until the editor shared the
 * edited project). Answers `{ report, text }`.
 */
import { readEvent, readJsonBody, readSyncedProject, requireToken } from "@/lib/server/bridge";
import { ExportRequestError } from "@/lib/server/export";
import { formatReport, runQualityCheck } from "@/lib/server/qa";
import type { Project } from "@/lib/types";

const SYNC_WAIT_MS = 12_000;

async function projectToCheck(eventId: string | undefined): Promise<Project | null> {
  const event = eventId ? await readEvent(eventId) : null;
  if (event?.type === "project") return event.project;
  const deadline = Date.now() + (event ? SYNC_WAIT_MS : 0);
  for (;;) {
    const synced = await readSyncedProject();
    const fresh = synced && (!event || (event.type === "edit" && synced.project.id === event.projectId && synced.syncedAt > event.at));
    if (fresh) return synced.project;
    if (Date.now() >= deadline) return synced?.project ?? null;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function POST(request: Request): Promise<Response> {
  const denied = await requireToken(request);
  if (denied) return denied;
  const body = (await readJsonBody(request)) as { eventId?: unknown } | null;
  const eventId = typeof body?.eventId === "string" ? body.eventId : undefined;
  const project = await projectToCheck(eventId);
  if (!project) return Response.json({ error: "No project to check: open WeDo Claude Motion in a browser first" }, { status: 409 });
  try {
    const report = await runQualityCheck(project, new URL(request.url).origin);
    return Response.json({ report, text: formatReport(report) });
  } catch (error) {
    if (error instanceof ExportRequestError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

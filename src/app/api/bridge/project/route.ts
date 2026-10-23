/**
 * /api/bridge/project — the project open in the editor.
 *   PUT  (editor)        body: Project. Called debounced on every change.
 *   GET  (CLI, token)    the last shared `{ project, syncedAt }`, 404 before the first PUT.
 */
import { connection } from "next/server";
import { z } from "zod";
import { ProjectSchema } from "@/lib/ai";
import { NO_STORE, readJsonBody, readSyncedProject, requireToken, syncProject } from "@/lib/server/bridge";

export async function GET(request: Request): Promise<Response> {
  await connection();
  const denied = await requireToken(request);
  if (denied) return denied;
  const synced = await readSyncedProject();
  if (!synced) return Response.json({ error: "No project shared yet: open Motion Studio in a browser" }, { status: 404 });
  return Response.json(synced, { headers: NO_STORE });
}

export async function PUT(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const parsed = ProjectSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: `Invalid project: ${z.prettifyError(parsed.error)}` }, { status: 400 });
  const synced = await syncProject(parsed.data);
  return Response.json({ ok: true, syncedAt: synced.syncedAt });
}

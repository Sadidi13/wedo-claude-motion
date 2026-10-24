/**
 * /api/bridge/events — changes Claude made from the desktop chat.
 *   GET  ?after=<cursor>  (editor) events newer than the cursor. Without a
 *        cursor: no events, only the current cursor (an editor that just
 *        opened must not replay old scenes).
 *   POST (CLI, token) body `{ type: "project", name, summary, code, files? }`
 *        for a new scene, or `{ type: "edit", summary, code, prompt?, layerId?, files? }`
 *        for the open project. Validated like an API reply: 201 with the event
 *        id, 422 with the validation error, 409 when no project is shared yet.
 */
import { connection, type NextRequest } from "next/server";
import { z } from "zod";
import {
  BridgePushSchema,
  NO_STORE,
  eventsAfter,
  isValidBridgeId,
  pushEdit,
  pushNewScene,
  readJsonBody,
  requireToken,
  touchEditor,
} from "@/lib/server/bridge";

export async function GET(request: NextRequest): Promise<Response> {
  await connection();
  const after = request.nextUrl.searchParams.get("after");
  const cursor = after === null ? null : after === "" || isValidBridgeId(after) ? after : null;
  if (after !== null && cursor === null) return Response.json({ error: "Invalid cursor" }, { status: 400 });
  // Only the editor polls this route, so it doubles as the editor's heartbeat.
  await touchEditor();
  return Response.json(await eventsAfter(cursor), { headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  const denied = await requireToken(request);
  if (denied) return denied;
  const parsed = BridgePushSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return Response.json({ error: `Invalid push: ${z.prettifyError(parsed.error)}` }, { status: 400 });
  const result = parsed.data.type === "project" ? await pushNewScene(parsed.data) : await pushEdit(parsed.data);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  const { event } = result;
  return Response.json(
    {
      ok: true,
      eventId: event.id,
      type: event.type,
      projectId: event.type === "project" ? event.project.id : event.type === "edit" ? event.projectId : null,
      layers: result.layers,
    },
    { status: 201 },
  );
}

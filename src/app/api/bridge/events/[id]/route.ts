/**
 * GET /api/bridge/events/[id] — one pushed scene or edit. When Claude makes a
 * scene and no editor tab is open, the tools open the browser at
 * `/?event=<id>`; the editor fetches that event here and applies it on load
 * (a freshly opened editor otherwise skips events from before it opened).
 */
import { connection } from "next/server";
import { NO_STORE, readEvent } from "@/lib/server/bridge";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params): Promise<Response> {
  await connection();
  const { id } = await params;
  const event = await readEvent(id);
  if (!event) return Response.json({ error: "Unknown event" }, { status: 404 });
  return Response.json(event, { headers: NO_STORE });
}

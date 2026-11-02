/**
 * POST /api/bridge/intake/[id] (autopilot, token) — Claude's turn of the wizard's conversation:
 * `{ reply, done, order? }` (an order is required once done). Declining goes through
 * /api/bridge/requests/<id>/result like any request.
 */
import { z } from "zod";
import { BridgeStateError, IntakeReplySchema, answerIntakeTurn, readJsonBody, requireToken } from "@/lib/server/bridge";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const denied = await requireToken(request);
  if (denied) return denied;
  const { id } = await params;
  const parsed = IntakeReplySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return Response.json({ error: `Invalid reply: ${z.prettifyError(parsed.error)}` }, { status: 422 });
  try {
    await answerIntakeTurn(id, parsed.data);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof BridgeStateError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

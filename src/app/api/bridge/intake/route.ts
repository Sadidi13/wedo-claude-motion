/**
 * POST /api/bridge/intake (editor) — the designer's turn of the New video wizard's conversation:
 * `{ messages: [{ role: "designer" | "claude", text }] }`, the whole conversation so far. Queues it
 * for the autopilot and answers 201 `{ id }`; poll /api/bridge/requests/<id> for `intakeResult`.
 */
import { z } from "zod";
import { BridgeStateError, IntakeStartSchema, readJsonBody, startIntakeTurn } from "@/lib/server/bridge";

export async function POST(request: Request): Promise<Response> {
  const parsed = IntakeStartSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return Response.json({ error: `Invalid conversation: ${z.prettifyError(parsed.error)}` }, { status: 400 });
  try {
    const record = await startIntakeTurn(parsed.data.messages);
    return Response.json({ id: record.id }, { status: 201 });
  } catch (error) {
    if (error instanceof BridgeStateError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

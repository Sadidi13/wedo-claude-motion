/**
 * POST /api/bridge/requests/[id]/result (CLI, token) — Claude's answer to a
 * claimed request: `{ summary, code, files? }` or `{ error }` to decline.
 * The answer is validated exactly like an API reply. 200 when the editor can
 * apply it; 422 with the validation error (the request stays claimed so the
 * answer can be fixed and sent again); 409 when the designer cancelled it.
 */
import { z } from "zod";
import { BridgeResultSchema, BridgeStateError, completeRequest, readJsonBody, readRequest, requireToken } from "@/lib/server/bridge";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const denied = await requireToken(request);
  if (denied) return denied;
  const { id } = await params;
  const record = await readRequest(id);
  if (!record) return Response.json({ error: `Unknown request "${id}"` }, { status: 404 });
  if (record.state !== "claimed" && record.state !== "pending") {
    return Response.json({ error: `Request "${id}" is already ${record.state}` }, { status: 409 });
  }

  const parsed = BridgeResultSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return Response.json({ error: `Invalid answer: ${z.prettifyError(parsed.error)}` }, { status: 400 });

  try {
    const result = await completeRequest(record, parsed.data);
    if (!result.ok && result.code !== "declined") return Response.json(result, { status: 422 });
    return Response.json(result);
  } catch (error) {
    if (error instanceof BridgeStateError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

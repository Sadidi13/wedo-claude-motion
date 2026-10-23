/**
 * POST /api/bridge/requests — the editor queues an Ask Claude request for the
 * Claude Desktop session. Body: `AiEditRequest` (same as /api/ai/edit).
 * Answers 202 `{ id }`; the editor then polls /api/bridge/requests/[id].
 */
import { z } from "zod";
import { AiEditRequestSchema } from "@/lib/ai";
import { createRequest, readJsonBody } from "@/lib/server/bridge";

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const parsed = AiEditRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: `Invalid request: ${z.prettifyError(parsed.error)}` }, { status: 400 });
  const record = await createRequest(parsed.data);
  return Response.json({ id: record.id }, { status: 202 });
}

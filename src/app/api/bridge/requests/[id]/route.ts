/**
 * /api/bridge/requests/[id] — one queued request.
 *   GET     (editor) its state and, once done, the validated result.
 *   DELETE  (editor) cancel it; Claude's later answer is then refused with 409.
 */
import { connection } from "next/server";
import { BridgeStateError, NO_STORE, finishRequest, readRequest, toView } from "@/lib/server/bridge";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params): Promise<Response> {
  await connection();
  const { id } = await params;
  const record = await readRequest(id);
  if (!record) return Response.json({ error: "Unknown request" }, { status: 404 });
  return Response.json(toView(record), { headers: NO_STORE });
}

export async function DELETE(_request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  try {
    return Response.json(toView(await finishRequest(id, { cancelled: true })));
  } catch (error) {
    if (error instanceof BridgeStateError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

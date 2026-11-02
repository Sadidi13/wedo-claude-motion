/**
 * PUT /api/bridge/boards/[id]/spec (editor) — the designer's corrections to the style spec Claude
 * read from the references: `{ spec }` (empty clears it). The storyboard and the build use the
 * corrected text. 200 with the board.
 */
import { BridgeStateError, readJsonBody, updateStyleSpec } from "@/lib/server/bridge";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  const body = (await readJsonBody(request)) as { spec?: unknown } | null;
  if (typeof body?.spec !== "string") return Response.json({ error: "Send { spec: string }" }, { status: 400 });
  try {
    return Response.json({ ok: true, board: await updateStyleSpec(id, body.spec) });
  } catch (error) {
    if (error instanceof BridgeStateError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

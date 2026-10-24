/**
 * POST /api/bridge/boards/[id]/references (editor) — attach reference images or
 * videos to a storyboard: `{ references: [{ name, dataUrl }] }`. Each gets a JPEG
 * preview (a contact sheet for videos) that Claude looks at in the next style step.
 * 200 with the board; 400 / 413 / 422 for files it cannot use.
 */
import { z } from "zod";
import { BoardReferencesSchema, BridgeStateError, addBoardReferences, readJsonBody } from "@/lib/server/bridge";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  const parsed = BoardReferencesSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return Response.json({ error: `Invalid references: ${z.prettifyError(parsed.error)}` }, { status: 400 });
  try {
    return Response.json({ ok: true, board: await addBoardReferences(id, parsed.data.references) });
  } catch (error) {
    if (error instanceof BridgeStateError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

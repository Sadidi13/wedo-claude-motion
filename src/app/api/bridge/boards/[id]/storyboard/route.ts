/**
 * POST /api/bridge/boards/[id]/storyboard (CLI, token) — Claude's storyboard in the
 * chosen style: `{ notes?, shots: [{ title, start, end, action, text?, audio?, code?, time? }] }`.
 * Sketches are validated like new scenes. 200 with the board, 422 with what to fix,
 * 409 when no style is chosen yet or the board is past the storyboard.
 */
import { z } from "zod";
import { BoardStoryboardSchema, BridgeStateError, proposeStoryboard, readJsonBody, requireToken } from "@/lib/server/bridge";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const denied = await requireToken(request);
  if (denied) return denied;
  const { id } = await params;
  const parsed = BoardStoryboardSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return Response.json({ error: `Invalid storyboard: ${z.prettifyError(parsed.error)}` }, { status: 400 });
  try {
    return Response.json({ ok: true, board: await proposeStoryboard(id, parsed.data) });
  } catch (error) {
    if (error instanceof BridgeStateError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

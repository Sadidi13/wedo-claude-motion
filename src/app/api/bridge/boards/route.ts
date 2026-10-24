/**
 * /api/bridge/boards — storyboards (docs/STORYBOARD.md).
 *   GET   (editor) the boards, newest first: `{ boards: BoardSummary[] }`.
 *   POST  (CLI, token) Claude's style frames: a new board, or `boardId` to fill the
 *         board the editor started. Each frame is validated like a new scene:
 *         201 with the board, 422 with what to fix, 409 when the board is past that step.
 */
import { connection } from "next/server";
import { z } from "zod";
import { BoardStylesSchema, BridgeStateError, NO_STORE, listBoards, proposeStyles, readJsonBody, requireToken } from "@/lib/server/bridge";

export async function GET(): Promise<Response> {
  await connection();
  return Response.json({ boards: await listBoards() }, { headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  const denied = await requireToken(request);
  if (denied) return denied;
  const parsed = BoardStylesSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return Response.json({ error: `Invalid style frames: ${z.prettifyError(parsed.error)}` }, { status: 400 });
  try {
    const board = await proposeStyles(parsed.data);
    return Response.json({ ok: true, board }, { status: 201 });
  } catch (error) {
    if (error instanceof BridgeStateError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

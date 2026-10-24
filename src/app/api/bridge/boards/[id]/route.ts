/**
 * /api/bridge/boards/[id] — one storyboard (docs/STORYBOARD.md).
 *   GET   (editor, CLI) the board.
 *   POST  the designer's decision `{ action: "choose-style", styleId, note? } |
 *         { action: "restyle", note? } | { action: "revise-storyboard", note } |
 *         { action: "approve", note? }`. From the editor it queues the next step for
 *         Claude; with the bridge token (Claude recording what the designer said in
 *         the chat) nothing is queued. 409 when the action does not fit the board's step.
 */
import { connection } from "next/server";
import { z } from "zod";
import {
  BoardActionSchema,
  BridgeStateError,
  NO_STORE,
  TOKEN_HEADER,
  boardAction,
  isValidToken,
  readBoard,
  readJsonBody,
} from "@/lib/server/bridge";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params): Promise<Response> {
  await connection();
  const { id } = await params;
  const board = await readBoard(id);
  if (!board) return Response.json({ error: "Unknown board" }, { status: 404 });
  return Response.json(board, { headers: NO_STORE });
}

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  const parsed = BoardActionSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return Response.json({ error: `Invalid action: ${z.prettifyError(parsed.error)}` }, { status: 400 });
  const fromClaude = await isValidToken(request.headers.get(TOKEN_HEADER));
  try {
    return Response.json({ ok: true, board: await boardAction(id, parsed.data, { fromClaude }) });
  } catch (error) {
    if (error instanceof BridgeStateError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

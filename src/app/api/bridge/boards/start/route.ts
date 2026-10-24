/**
 * POST /api/bridge/boards/start (editor) — the designer asked for a new video in
 * the Ask Claude tab: an empty board waiting for Claude's style frames, and a
 * storyboard request queued for whoever listens. Body `{ brief, stage? }`; 201 with the board.
 */
import { z } from "zod";
import { BoardStartSchema, BridgeStateError, readJsonBody, startBoard } from "@/lib/server/bridge";

export async function POST(request: Request): Promise<Response> {
  const parsed = BoardStartSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return Response.json({ error: `Invalid request: ${z.prettifyError(parsed.error)}` }, { status: 400 });
  try {
    return Response.json({ ok: true, board: await startBoard(parsed.data) }, { status: 201 });
  } catch (error) {
    if (error instanceof BridgeStateError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

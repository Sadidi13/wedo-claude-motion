/**
 * POST /api/bridge/claim (CLI, token) — listener heartbeat. Claims the oldest
 * pending request and answers 200 with it and its Markdown brief, or 204
 * when nothing is waiting. `motion-bridge wait` and the MCP connector's
 * `wait_for_request` and the autopilot call this about once a second;
 * `?client=mcp|headless` words the brief's "how to answer" for the connector's
 * tools or the autopilot's JSON reply instead of the CLI, and is shown in the editor.
 *
 * `kind` is "edit" for Ask Claude requests and "board" for storyboard steps
 * (docs/STORYBOARD.md); a board request also carries the board itself.
 */
import { parseScene } from "@/lib/parser";
import type { BridgeClient } from "@/lib/types";
import { buildBoardBrief, buildBrief, claimNextRequest, deliverableFor, finishRequest, readBoard, requireToken } from "@/lib/server/bridge";

function layerName(source: string | undefined, id: string): string | null {
  if (source === undefined) return null;
  try {
    return parseScene(source).byId[id]?.name ?? null;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const denied = await requireToken(request);
  if (denied) return denied;
  const requested = new URL(request.url).searchParams.get("client");
  const client: BridgeClient = requested === "mcp" || requested === "headless" ? requested : "cli";
  const record = await claimNextRequest(new Date(), client);
  if (!record) return new Response(null, { status: 204 });
  const req = record.request;

  if (record.board) {
    const board = await readBoard(record.board.boardId);
    if (!board) {
      // The board was deleted (pruned); nothing to do for this step.
      await finishRequest(record.id, { error: "The storyboard no longer exists" });
      return new Response(null, { status: 204 });
    }
    return Response.json({
      id: record.id,
      kind: "board",
      action: record.board.action,
      deliverable: deliverableFor(record.board.action),
      boardId: board.id,
      board,
      scope: req.scope,
      prompt: record.board.note ?? (record.board.action === "new" ? board.brief : record.board.action),
      layerId: null,
      layerName: null,
      project: { id: board.id, name: board.title, entry: "scene.jsx" },
      createdAt: record.createdAt,
      brief: buildBoardBrief(record, board, client),
      files: [],
    });
  }

  return Response.json({
    id: record.id,
    kind: "edit",
    scope: req.scope,
    prompt: req.prompt,
    layerId: req.layerId ?? null,
    layerName: req.layerId ? layerName(req.project.files[req.project.entry]?.content, req.layerId) : null,
    project: { id: req.project.id, name: req.project.name, entry: req.project.entry },
    createdAt: record.createdAt,
    brief: buildBrief(record, client),
    files: Object.values(req.project.files)
      .filter((file) => file.kind !== "asset")
      .map((file) => ({ path: file.path, content: file.content })),
  });
}

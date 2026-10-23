/**
 * POST /api/bridge/claim (CLI, token) — listener heartbeat. Claims the oldest
 * pending request and answers 200 with it and its Markdown brief, or 204
 * when nothing is waiting. `motion-bridge wait` calls this about once a second.
 */
import { parseScene } from "@/lib/parser";
import { buildBrief, claimNextRequest, requireToken } from "@/lib/server/bridge";

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
  const record = await claimNextRequest();
  if (!record) return new Response(null, { status: 204 });
  const req = record.request;
  return Response.json({
    id: record.id,
    scope: req.scope,
    prompt: req.prompt,
    layerId: req.layerId ?? null,
    layerName: req.layerId ? layerName(req.project.files[req.project.entry]?.content, req.layerId) : null,
    project: { id: req.project.id, name: req.project.name, entry: req.project.entry },
    createdAt: record.createdAt,
    brief: buildBrief(record),
    files: Object.values(req.project.files)
      .filter((file) => file.kind !== "asset")
      .map((file) => ({ path: file.path, content: file.content })),
  });
}

/**
 * /api/media/[id]/analysis — a reference video or image measured on this computer (docs/STORYBOARD.md):
 *   GET   `{ status, analysis }`: "processing" / "ready" / "error", and ReferenceAnalysis once ready.
 *   POST  start it (queued; a 40-second reel takes about half a minute).
 * The sheets and strips it wrote are served by ./[file].
 */
import { connection } from "next/server";
import { isValidMediaId, readMeta } from "@/lib/server/media";
import { isAnalysing, readAnalysis, startAnalysis } from "@/lib/server/media/analysis";

type Params = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(_request: Request, { params }: Params): Promise<Response> {
  await connection();
  const { id } = await params;
  if (!isValidMediaId(id)) return Response.json({ error: "Invalid media id" }, { status: 400 });
  const meta = await readMeta(id);
  if (!meta) return Response.json({ error: "Unknown media" }, { status: 404 });
  let status = meta.analysis ?? null;
  if (status?.state === "processing" && !isAnalysing(id)) status = { state: "error", error: "The analysis was interrupted (the server restarted). Start it again." };
  return Response.json({ status, analysis: status?.state === "ready" ? await readAnalysis(id) : null }, { headers: NO_STORE });
}

export async function POST(_request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  if (!isValidMediaId(id)) return Response.json({ error: "Invalid media id" }, { status: 400 });
  try {
    await startAnalysis(id);
    return Response.json({ status: { state: "processing" } }, { status: 202, headers: NO_STORE });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}

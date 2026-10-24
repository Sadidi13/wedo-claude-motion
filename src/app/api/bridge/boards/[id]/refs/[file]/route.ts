/**
 * GET /api/bridge/boards/[id]/refs/[file] — one of a storyboard's reference files
 * or previews (`r1.preview.jpg`, `r1.mp4`, …), for the storyboard view.
 */
import { connection } from "next/server";
import { readReferenceFile } from "@/lib/server/bridge";

type Params = { params: Promise<{ id: string; file: string }> };

export async function GET(_request: Request, { params }: Params): Promise<Response> {
  await connection();
  const { id, file } = await params;
  const found = await readReferenceFile(id, file).catch(() => null);
  if (!found) return Response.json({ error: "Unknown reference" }, { status: 404 });
  return new Response(new Uint8Array(found.bytes), {
    headers: { "content-type": found.type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" },
  });
}

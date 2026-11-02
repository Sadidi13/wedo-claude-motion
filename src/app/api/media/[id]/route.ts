/** GET /api/media/[id] — one video's MediaMeta (the runtime polls it while the file is processing). */
import { connection } from "next/server";
import { mediaRef } from "@/lib/media";
import { isValidMediaId, readMeta } from "@/lib/server/media";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params): Promise<Response> {
  await connection();
  const { id } = await params;
  if (!isValidMediaId(id)) return Response.json({ error: "Invalid media id" }, { status: 400 });
  const meta = await readMeta(id);
  if (!meta) return Response.json({ error: "Unknown media" }, { status: 404 });
  return Response.json({ ...meta, ref: mediaRef(meta.id, meta.ext) }, { headers: { "Cache-Control": "no-store" } });
}

/** GET /api/media — every file in the media library (MediaMeta[] with `ref`, newest first; docs/VIDEO.md). */
import { connection } from "next/server";
import { mediaRef } from "@/lib/media";
import { listMedia } from "@/lib/server/media";

export async function GET(): Promise<Response> {
  await connection();
  const list = await listMedia();
  return Response.json(list.map((meta) => ({ ...meta, ref: mediaRef(meta.id, meta.ext) })), { headers: { "Cache-Control": "no-store" } });
}

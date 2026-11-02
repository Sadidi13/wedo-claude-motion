/**
 * GET /api/media/[id]/frames/[frame] — one export frame as JPEG (0-based). <Video> draws these in
 * exports, so every frame is exact; they never change, so they cache forever.
 */
import { readFile } from "node:fs/promises";
import { connection } from "next/server";
import { isValidMediaId, mediaPaths } from "@/lib/server/media";

type Params = { params: Promise<{ id: string; frame: string }> };

export async function GET(_request: Request, { params }: Params): Promise<Response> {
  await connection();
  const { id, frame } = await params;
  if (!isValidMediaId(id) || !/^\d{1,7}$/.test(frame)) return Response.json({ error: "Invalid frame" }, { status: 400 });
  try {
    const bytes = await readFile(mediaPaths.frame(id, Number(frame)));
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return Response.json({ error: "No such frame" }, { status: 404 });
  }
}

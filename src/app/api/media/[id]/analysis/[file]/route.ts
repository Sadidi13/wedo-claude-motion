/** GET /api/media/[id]/analysis/[file] — one contact sheet or transition strip of a reference (JPEG). */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { connection } from "next/server";
import { isValidMediaId } from "@/lib/server/media";
import { ANALYSIS_IMAGE, analysisDir } from "@/lib/server/media/analysis";

type Params = { params: Promise<{ id: string; file: string }> };

export async function GET(_request: Request, { params }: Params): Promise<Response> {
  await connection();
  const { id, file } = await params;
  if (!isValidMediaId(id) || !ANALYSIS_IMAGE.test(file)) return Response.json({ error: "Invalid file" }, { status: 400 });
  const bytes = await readFile(path.join(analysisDir(id), file)).catch(() => null);
  if (!bytes) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" } });
}

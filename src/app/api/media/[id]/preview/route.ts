/**
 * GET /api/media/[id]/preview — the light H.264 copy the editor's <video> plays, with HTTP Range
 * support (browsers seek with range requests).
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { connection } from "next/server";
import { isValidMediaId, mediaPaths } from "@/lib/server/media";
import { parseRange } from "@/lib/server/media/range";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  await connection();
  const { id } = await params;
  if (!isValidMediaId(id)) return Response.json({ error: "Invalid media id" }, { status: 400 });
  const file = mediaPaths.preview(id);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return Response.json({ error: "The preview is not ready yet" }, { status: 404 });

  const range = parseRange(request.headers.get("range"), info.size);
  const headers: Record<string, string> = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "no-cache" };
  if (request.headers.get("range") && !range) {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${info.size}` } });
  }
  const { start, end } = range ?? { start: 0, end: info.size - 1 };
  // Node's web ReadableStream type is structurally identical to the DOM one, but TS keeps them distinct.
  const body = Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream;
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      ...headers,
      "Content-Length": String(end - start + 1),
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${info.size}` } : {}),
    },
  });
}

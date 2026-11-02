/**
 * GET /api/media/[id]/file — a library file as imported (sound for <Audio>, images, fonts), with
 * HTTP Range support. A file is never run as a page: scripts in an SVG opened directly stay inert
 * (`Content-Security-Policy: sandbox`), and the type always comes from the extension.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { connection } from "next/server";
import { MEDIA_CONTENT_TYPES } from "@/lib/media";
import { isValidMediaId, mediaPaths, readMeta } from "@/lib/server/media";
import { parseRange } from "@/lib/server/media/range";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  await connection();
  const { id } = await params;
  if (!isValidMediaId(id)) return Response.json({ error: "Invalid media id" }, { status: 400 });
  const meta = await readMeta(id);
  if (!meta) return Response.json({ error: "Unknown media" }, { status: 404 });
  const file = mediaPaths.source(id, meta.ext);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return Response.json({ error: "The file is missing" }, { status: 404 });

  const headers: Record<string, string> = {
    "Content-Type": MEDIA_CONTENT_TYPES[meta.ext] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:",
  };
  const range = parseRange(request.headers.get("range"), info.size);
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

/**
 * POST /api/media/import-url — `{ url }`: download a video from a link (an Instagram reel, a
 * YouTube video) into the media library with yt-dlp, at most 1080p (src/lib/server/media/download.ts).
 * Answers 202 at once with the new file's meta ("processing"); poll /api/media/<id> until it is ready.
 */
import { mediaRef } from "@/lib/media";
import { readJsonBody } from "@/lib/server/bridge";
import { importFromLink } from "@/lib/server/media/download";

export async function POST(request: Request): Promise<Response> {
  const body = (await readJsonBody(request)) as { url?: unknown } | null;
  if (typeof body?.url !== "string") return Response.json({ error: "Send { url }" }, { status: 400 });
  try {
    const meta = await importFromLink(body.url);
    return Response.json({ ...meta, ref: mediaRef(meta.id, meta.ext) }, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

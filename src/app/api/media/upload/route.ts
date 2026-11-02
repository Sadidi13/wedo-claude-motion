/**
 * POST /api/media/upload — import a video into the media library (docs/VIDEO.md).
 * Body: the raw file as `application/octet-stream`; header `X-File-Name` (URI-encoded) names it.
 * Answers 201 with its MediaMeta (state "processing") and `ref`, the `media/<id>.<ext>` scene code
 * uses. src/proxy.ts skips this route so the body streams to disk; the guard runs here instead.
 */

import { NextResponse, type NextRequest } from "next/server";
import { mediaRef } from "@/lib/media";
import { SECURITY_HEADERS, checkMediaUpload } from "@/lib/server/guard";
import { MediaUploadError, importVideo } from "@/lib/server/media";

function json(body: unknown, status: number): NextResponse {
  const response = NextResponse.json(body, { status });
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  return response;
}

export async function POST(request: NextRequest) {
  const verdict = checkMediaUpload({
    method: request.method,
    pathname: request.nextUrl.pathname,
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    contentType: request.headers.get("content-type"),
    contentLength: request.headers.get("content-length"),
    allowedHosts: process.env.MOTION_STUDIO_ALLOWED_HOSTS,
  });
  if (!verdict.ok) return json({ error: verdict.error }, verdict.status);
  try {
    const meta = await importVideo(request.body, request.headers.get("x-file-name"));
    return json({ ...meta, ref: mediaRef(meta.id, meta.ext) }, 201);
  } catch (error) {
    if (error instanceof MediaUploadError) return json({ error: error.message }, error.status);
    console.error("[media] upload failed:", error);
    return json({ error: "Could not store the video" }, 500);
  }
}

/**
 * GET /api/export/[jobId]/download — streams the finished file with the
 * format's Content-Type and an attachment Content-Disposition (CONTRACTS.md §6).
 * 404 until the job's state is "done".
 */

import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { isValidJobId, resolveDownload } from "@/lib/server/export";

/** `attachment; filename="ascii"; filename*=UTF-8''…` so non-ASCII project names survive. */
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!isValidJobId(jobId)) return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  const download = await resolveDownload(jobId);
  if (!download) return NextResponse.json({ error: "Export is not finished or does not exist" }, { status: 404 });

  // Node's web ReadableStream type is structurally identical to the DOM one, but TS keeps them distinct.
  const body = Readable.toWeb(createReadStream(download.path)) as unknown as ReadableStream;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": download.contentType,
      "Content-Length": String(download.size),
      "Content-Disposition": contentDisposition(download.fileName),
      "Cache-Control": "no-store",
    },
  });
}

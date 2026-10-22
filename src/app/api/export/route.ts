/**
 * POST /api/export — body `ExportRequest` (CONTRACTS.md §6).
 * Validates, stores the job, starts rendering in the background and answers
 * 202 `{ jobId }`. The preview origin handed to the renderer is this request's.
 */

import { NextResponse, type NextRequest } from "next/server";
import { ExportRequestError, startExport } from "@/lib/server/export";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  try {
    const jobId = await startExport(body, request.nextUrl.origin);
    return NextResponse.json({ jobId }, { status: 202 });
  } catch (error) {
    if (error instanceof ExportRequestError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[export] could not start job:", error);
    return NextResponse.json({ error: "Could not start the export job" }, { status: 500 });
  }
}

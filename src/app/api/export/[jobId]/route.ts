/**
 * GET /api/export/[jobId] — the job's `ExportJobStatus` from status.json
 * (CONTRACTS.md §6). Polled by the editor, so never cached.
 */

import { NextResponse } from "next/server";
import { isValidJobId, readStatus } from "@/lib/server/export";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!isValidJobId(jobId)) return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  const status = await readStatus(jobId);
  if (!status) return NextResponse.json({ error: "Unknown export job" }, { status: 404 });
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}

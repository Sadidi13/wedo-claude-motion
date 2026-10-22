/**
 * GET /api/export/[jobId]/project — the stored `Project` JSON that
 * `/preview?job=<id>` loads inside headless Chromium (CONTRACTS.md §6).
 */

import { NextResponse } from "next/server";
import { isValidJobId, readProject } from "@/lib/server/export";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!isValidJobId(jobId)) return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  const project = await readProject(jobId);
  if (!project) return NextResponse.json({ error: "Unknown export job" }, { status: 404 });
  return NextResponse.json(project, { headers: { "Cache-Control": "no-store" } });
}

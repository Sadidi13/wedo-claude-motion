/**
 * POST /api/qa (editor) — the automatic quality check (docs/QUALITY.md) of the
 * project in the body (`{ project }`): renders it headlessly, about two frames
 * per second, and answers with `{ report, text }`. Takes a few seconds to a
 * minute; one check runs at a time (429 otherwise).
 */
import { readJsonBody } from "@/lib/server/bridge";
import { ExportRequestError } from "@/lib/server/export";
import { formatReport, runQualityCheck } from "@/lib/server/qa";
import type { Project } from "@/lib/types";

export async function POST(request: Request): Promise<Response> {
  const body = (await readJsonBody(request)) as { project?: Project } | null;
  if (!body?.project) return Response.json({ error: "Send { project }" }, { status: 400 });
  try {
    const report = await runQualityCheck(body.project, new URL(request.url).origin);
    return Response.json({ report, text: formatReport(report) });
  } catch (error) {
    if (error instanceof ExportRequestError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

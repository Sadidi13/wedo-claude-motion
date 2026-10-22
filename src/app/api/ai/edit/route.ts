/**
 * POST /api/ai/edit — thin HTTP wrapper around the AI service (CONTRACTS §5).
 *
 * Validates the JSON body with zod (`AiEditRequest`), hands it to the service
 * and maps the result to a status code: 400 bad body, 503 missing API key,
 * 502 upstream API errors, 422 unusable model output, 200 ok. The body is
 * always `AiEditResponse | AiErrorResponse`. Reading the request body keeps
 * this handler at request time; no `runtime` export (cacheComponents is on).
 */
import { z } from "zod";
import { AiEditRequestSchema, createAiService, httpStatusFor } from "@/lib/ai";
import type { AiErrorResponse } from "@/lib/types";

const service = createAiService();

function badRequest(error: string): Response {
  const body: AiErrorResponse = { ok: false, code: "bad_request", error };
  return Response.json(body, { status: 400 });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be JSON");
  }
  const parsed = AiEditRequestSchema.safeParse(body);
  if (!parsed.success) return badRequest(`Invalid request: ${z.prettifyError(parsed.error)}`);

  const result = await service.edit(parsed.data);
  return Response.json(result, { status: httpStatusFor(result) });
}

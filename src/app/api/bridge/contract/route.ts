/**
 * GET /api/bridge/contract — the authoring contract and output rules Claude
 * must follow (the API path's system prompt), as Markdown. Static.
 */
import { SYSTEM_PROMPT } from "@/lib/ai";

export function GET(): Response {
  return new Response(SYSTEM_PROMPT, { headers: { "content-type": "text/markdown; charset=utf-8" } });
}

/**
 * GET /api/bridge/contract — the authoring contract and output rules Claude
 * must follow (the API path's system prompt), followed by the storyboard
 * process for new videos (docs/STORYBOARD.md), as Markdown. Static.
 * `?part=styles` returns the style library with its recipes instead.
 */
import type { NextRequest } from "next/server";
import { STORYBOARD_GUIDE, SYSTEM_PROMPT, styleLibraryMarkdown } from "@/lib/ai";

const MARKDOWN = { "content-type": "text/markdown; charset=utf-8" };

export function GET(request: NextRequest): Response {
  if (request.nextUrl.searchParams.get("part") === "styles") return new Response(styleLibraryMarkdown(), { headers: MARKDOWN });
  return new Response(`${SYSTEM_PROMPT}\n\n${STORYBOARD_GUIDE}`, { headers: MARKDOWN });
}

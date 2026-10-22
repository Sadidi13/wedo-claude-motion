/**
 * GET /api/ai/status — tells the editor whether Claude is configured
 * (`ANTHROPIC_API_KEY` present) and which model will be used.
 *
 * `connection()` keeps the handler at request time: with cacheComponents on,
 * a GET handler that touches no runtime data is prerendered at build time,
 * which would bake the build machine's environment into the answer.
 */
import { connection } from "next/server";
import { resolveModel } from "@/lib/ai";

export async function GET(): Promise<Response> {
  await connection();
  return Response.json({ configured: Boolean(process.env.ANTHROPIC_API_KEY), model: resolveModel() });
}

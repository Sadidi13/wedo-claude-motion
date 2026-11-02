/** GET /api/fonts/installed — the fonts installed on this computer, by family (src/lib/server/fonts/installed.ts). */
import { connection } from "next/server";
import { listInstalledFonts } from "@/lib/server/fonts/installed";

export async function GET(): Promise<Response> {
  await connection();
  return Response.json({ families: await listInstalledFonts() }, { headers: { "Cache-Control": "no-store" } });
}

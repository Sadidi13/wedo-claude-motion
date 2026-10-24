/**
 * GET /api/audio/sfx/[name] — a built-in sound effect as WAV (rendered with
 * ffmpeg on first use, then cached). The editor preview plays these for
 * <Audio sfx="…"> layers; GET /api/audio/sfx/list returns the catalogue.
 */
import { readFile } from "node:fs/promises";
import { connection } from "next/server";
import { SFX, isSfxName } from "@/lib/audio/sfx";
import { ensureSfx } from "@/lib/server/audio";

type Params = { params: Promise<{ name: string }> };

export async function GET(_request: Request, { params }: Params): Promise<Response> {
  await connection();
  const { name } = await params;
  if (name === "list") {
    return Response.json(Object.entries(SFX).map(([id, s]) => ({ id, label: s.label, use: s.use, duration: s.duration, loop: Boolean(s.loop) })));
  }
  if (!isSfxName(name)) return Response.json({ error: "Unknown sound effect" }, { status: 404 });
  try {
    const bytes = await readFile(await ensureSfx(name));
    return new Response(new Uint8Array(bytes), {
      headers: { "content-type": "audio/wav", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    return Response.json({ error: `Could not render "${name}": ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
  }
}

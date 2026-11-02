/**
 * GET /api/audio/sound/[name] — a real recorded sound (CC0, Freesound) as WAV: downloaded, trimmed
 * and levelled on first use, then cached (src/lib/server/audio.ts). The editor preview plays these
 * for <Audio sound="…"> layers; GET /api/audio/sound/list returns the bank.
 */
import { readFile } from "node:fs/promises";
import { connection } from "next/server";
import { REAL_SOUNDS, REAL_SOUND_LICENSE, isRealSoundName } from "@/lib/audio/realSounds";
import { ensureRealSound } from "@/lib/server/audio";

type Params = { params: Promise<{ name: string }> };

export async function GET(_request: Request, { params }: Params): Promise<Response> {
  await connection();
  const { name } = await params;
  if (name === "list") {
    return Response.json({
      license: REAL_SOUND_LICENSE,
      sounds: Object.entries(REAL_SOUNDS).map(([id, s]) => ({ id, use: s.use, duration: s.duration, peak: s.peak, author: s.source.author, title: s.source.title })),
    });
  }
  if (!isRealSoundName(name)) return Response.json({ error: "Unknown sound" }, { status: 404 });
  try {
    const bytes = await readFile(await ensureRealSound(name));
    return new Response(new Uint8Array(bytes), {
      headers: { "content-type": "audio/wav", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}

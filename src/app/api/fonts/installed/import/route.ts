/**
 * POST /api/fonts/installed/import — `{ family }`: copy every face of an installed font into the
 * media library, so the scene can load it by reference and exports render it. Answers with the
 * library files (MediaMeta[] with `ref`).
 */
import { mediaRef } from "@/lib/media";
import { readJsonBody } from "@/lib/server/bridge";
import { importInstalledFamily } from "@/lib/server/fonts/installed";

export async function POST(request: Request): Promise<Response> {
  const body = (await readJsonBody(request)) as { family?: unknown } | null;
  if (typeof body?.family !== "string" || !body.family.trim()) return Response.json({ error: "Send { family }" }, { status: 400 });
  try {
    const metas = await importInstalledFamily(body.family);
    return Response.json({ fonts: metas.map((meta) => ({ ...meta, ref: mediaRef(meta.id, meta.ext) })) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

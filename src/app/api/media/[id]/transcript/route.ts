/**
 * /api/media/[id]/transcript — what is said in a library video or sound (docs/VIDEO.md).
 *   GET   `{ status, transcript, available }`: the Whisper status, the transcript once ready, and
 *         whether Whisper is set up on this computer.
 *   POST  `{ language? }` ("fa", "en", …): start transcribing (queued; takes minutes on a CPU).
 *   PUT   `{ texts: string[] }`: the designer's corrections, one text per segment.
 */
import { connection } from "next/server";
import { readJsonBody } from "@/lib/server/bridge";
import { isValidMediaId, readMeta } from "@/lib/server/media";
import { canTranscribe, correctTranscript, readTranscript, startTranscript, transcriptStatus, whisperPython } from "@/lib/server/media/transcribe";

type Params = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(_request: Request, { params }: Params): Promise<Response> {
  await connection();
  const { id } = await params;
  if (!isValidMediaId(id)) return Response.json({ error: "Invalid media id" }, { status: 400 });
  const meta = await readMeta(id);
  if (!meta) return Response.json({ error: "Unknown media" }, { status: 404 });
  const status = transcriptStatus(meta);
  return Response.json(
    { status, transcript: status?.state === "ready" ? await readTranscript(id) : null, available: whisperPython() !== null, canTranscribe: canTranscribe(meta) },
    { headers: NO_STORE },
  );
}

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  if (!isValidMediaId(id)) return Response.json({ error: "Invalid media id" }, { status: 400 });
  if (!whisperPython()) {
    return Response.json({ error: "Whisper is not set up on this computer, so type the words in the script box instead." }, { status: 503 });
  }
  const body = (await readJsonBody(request)) as { language?: unknown } | null;
  try {
    const meta = await startTranscript(id, typeof body?.language === "string" ? body.language : undefined);
    return Response.json({ status: transcriptStatus(meta) }, { status: 202, headers: NO_STORE });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}

export async function PUT(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  if (!isValidMediaId(id)) return Response.json({ error: "Invalid media id" }, { status: 400 });
  const body = (await readJsonBody(request)) as { texts?: unknown } | null;
  const texts = body?.texts;
  if (!Array.isArray(texts) || !texts.every((text) => typeof text === "string")) {
    return Response.json({ error: "Send { texts: string[] }" }, { status: 400 });
  }
  try {
    return Response.json({ transcript: await correctTranscript(id, texts) }, { headers: NO_STORE });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}

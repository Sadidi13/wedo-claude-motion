/**
 * Importing a video into the media library from a streamed request body (POST /api/media/upload):
 * the bytes go straight to `<id>/source.<ext>` (never held in memory), meta.json starts in the
 * "processing" state and ingest runs in the background.
 */

import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { VIDEO_EXTENSIONS, type MediaMeta } from "@/lib/media";
import { MAX_MEDIA_UPLOAD_BYTES } from "../guard";
import { startIngest } from "./ingest";
import { mediaDir, mediaPaths, newMediaId, writeMeta } from "./store";

export class MediaUploadError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** A display name without folders or control characters, at most 120 characters. */
export function cleanFileName(raw: string | null): string {
  let name = raw ?? "";
  try {
    name = decodeURIComponent(name);
  } catch {
    // keep it as sent
  }
  name = name.split(/[\\/]/).pop() ?? "";
  name = name.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return name.slice(0, 120) || "video.mp4";
}

export function extensionOf(name: string): string | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return (VIDEO_EXTENSIONS as readonly string[]).includes(ext) ? ext : null;
}

/** Store the streamed file, start processing it, and return its (processing) meta. */
export async function importVideo(body: ReadableStream<Uint8Array> | null, rawName: string | null): Promise<MediaMeta> {
  if (!body) throw new MediaUploadError("The request has no body");
  const name = cleanFileName(rawName);
  const ext = extensionOf(name);
  if (!ext) throw new MediaUploadError(`"${name}" is not a video file (${VIDEO_EXTENSIONS.join(", ")})`, 415);

  const id = newMediaId();
  await mkdir(mediaDir(id), { recursive: true });
  const target = mediaPaths.source(id, ext);
  const partial = `${target}.part`;
  let size = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > MAX_MEDIA_UPLOAD_BYTES) callback(new MediaUploadError("The video is too large", 413));
      else callback(null, chunk);
    },
  });
  try {
    // Node's web ReadableStream type is structurally identical to the DOM one, but TS keeps them distinct.
    await pipeline(Readable.fromWeb(body as unknown as import("node:stream/web").ReadableStream), limit, createWriteStream(partial));
    if (size === 0) throw new MediaUploadError("The uploaded file is empty");
    await rename(partial, target);
  } catch (error) {
    await rm(mediaDir(id), { recursive: true, force: true });
    throw error;
  }

  const meta: MediaMeta = {
    id,
    name,
    ext,
    size,
    state: "processing",
    duration: 0,
    sourceFps: 0,
    width: 0,
    height: 0,
    hasAudio: false,
    frameRate: 0,
    frameCount: 0,
    frameWidth: 0,
    frameHeight: 0,
    createdAt: new Date().toISOString(),
  };
  await writeMeta(meta);
  void startIngest(id);
  return meta;
}

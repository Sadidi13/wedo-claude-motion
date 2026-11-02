/**
 * Reference images and videos the designer attaches to a storyboard
 * (docs/STORYBOARD.md). Stored next to the boards; each one gets a JPEG
 * preview made locally with ffmpeg: a downscaled copy of an image, or a
 * contact sheet of a video's frames (evenly spaced, left to right, top to
 * bottom). Claude looks at the previews, one image per reference, instead of
 * whole videos.
 *
 *   refs/<boardId>/r1.<ext>          the file as uploaded
 *   refs/<boardId>/r1.preview.jpg    what Claude sees
 *
 * The files come from the designer's own editor (same trust as importing a
 * project); names are never used as paths, only the generated r<n>.<ext>.
 */

import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { dataUrlToBytes, extensionOf } from "@/lib/importer/dataUrl";
import { mediaKindOf } from "@/lib/media";
import type { BoardReference } from "@/lib/types";
import { ffmpegPath, runFfmpeg } from "../export/ffmpeg";
import { analysisDir, ensureAnalysis } from "../media/analysis";
import { mediaPaths, readMeta } from "../media/store";
import { BridgeStateError, bridgeRoot, isValidBridgeId } from "./store";

export const MAX_REFERENCES = 4;
/** Per file, after base64 decoding (the request body is capped at 64 MB). */
export const MAX_REFERENCE_BYTES = 40 * 1024 * 1024;

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "m4v", "mkv"]);
const PREVIEW_WIDTH = 1280;
const SHEET_TILE_WIDTH = 400;

export const ReferenceUploadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** data: URL of the file (base64) */
  dataUrl: z.string().min(16),
});

export type ReferenceUpload = z.infer<typeof ReferenceUploadSchema>;

export function referencesDir(boardId: string): string {
  if (!isValidBridgeId(boardId)) throw new BridgeStateError(`Invalid board id "${boardId}"`, 400);
  return path.join(bridgeRoot(), "refs", boardId);
}

/** Absolute path of one of a board's reference files; null for names it does not own. */
export function referenceFile(boardId: string, file: string): string | null {
  if (!/^r\d{1,2}\.(?:preview\.jpg|(?:sheet|strip)-\d{2}\.jpg|[a-z0-9]{2,5})$/.test(file)) return null;
  return path.join(referencesDir(boardId), file);
}

/** Images Claude sees across all of a board's references, at most this many (the style step's message). */
export const MAX_REFERENCE_IMAGES = 20;

/**
 * The reference images Claude is shown, in order: per reference its contact sheets then its
 * transition strips (or its one preview), until MAX_REFERENCE_IMAGES. The autopilot attaches these
 * files in this order and the brief describes them in the same order (scripts/lib/bridge-client.mjs
 * `boardReferenceFiles` follows the same rule).
 */
export function referenceImageList(references: BoardReference[]): { ref: BoardReference; file: string; label: string }[] {
  const list: { ref: BoardReference; file: string; label: string }[] = [];
  for (const ref of references) {
    const images = ref.sheets?.length
      ? [
          ...ref.sheets.map((sheet, i) => ({
            file: sheet.file,
            label: sheet.times.length
              ? `${ref.id} contact sheet ${i + 1}: ${sheet.columns}x${sheet.rows} frames from ${sheet.times[0]}s to ${sheet.times[sheet.times.length - 1]}s, left to right, top to bottom`
              : `${ref.id}: the image`,
          })),
          ...(ref.strips ?? []).map((strip, i) => ({
            file: strip.file,
            label: `${ref.id} transition ${i + 1}: every frame from ${strip.times[0]}s to ${strip.times[strip.times.length - 1]}s around the cut at ${strip.cut}s, left to right, top to bottom`,
          })),
        ]
      : [{ file: ref.preview, label: ref.kind === "video" ? `${ref.id}: contact sheet of the video` : `${ref.id}: the image` }];
    for (const image of images) {
      if (list.length >= MAX_REFERENCE_IMAGES) return list;
      list.push({ ref, ...image });
    }
  }
  return list;
}

function displayName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? name;
  return base.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120) || "reference";
}

/** Video duration in seconds from ffmpeg's banner (no ffprobe needed); null when unknown. */
function probeDuration(file: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath(), ["-hide_banner", "-i", file], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-20_000);
    });
    child.on("error", () => resolve(null));
    child.on("close", () => {
      const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
      resolve(match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null);
    });
  });
}

/** Frames a contact sheet shows: 12 (4x3), or 16 (4x4) for clips over 20 s. */
export function sheetLayout(duration: number): { columns: number; rows: number; times: number[] } {
  const columns = 4;
  const rows = duration > 20 ? 4 : 3;
  const count = columns * rows;
  const times = Array.from({ length: count }, (_, i) => Number((((i + 0.5) * duration) / count).toFixed(2)));
  return { columns, rows, times };
}

/**
 * Save one upload as reference r<index> of the board and make its preview. Throws
 * BridgeStateError (400 / 413 / 422) for files it cannot use.
 */
export async function saveReference(boardId: string, index: number, upload: ReferenceUpload): Promise<BoardReference> {
  const ext = extensionOf(upload.name);
  const kind = IMAGE_EXTENSIONS.has(ext) ? "image" : VIDEO_EXTENSIONS.has(ext) ? "video" : null;
  if (!kind) {
    throw new BridgeStateError(`"${displayName(upload.name)}": references can be images (png, jpg, webp, gif) or videos (mp4, mov, webm)`, 400);
  }
  let bytes: Uint8Array;
  try {
    bytes = dataUrlToBytes(upload.dataUrl).bytes;
  } catch {
    throw new BridgeStateError(`"${displayName(upload.name)}" is not a data: URL`, 400);
  }
  if (bytes.byteLength > MAX_REFERENCE_BYTES) {
    throw new BridgeStateError(`"${displayName(upload.name)}" is larger than ${MAX_REFERENCE_BYTES / 1024 / 1024} MB`, 413);
  }
  const dir = referencesDir(boardId);
  await mkdir(dir, { recursive: true });
  const id = `r${index}`;
  const file = `${id}.${ext === "jpeg" ? "jpg" : ext}`;
  const preview = `${id}.preview.jpg`;
  const source = path.join(dir, file);
  await writeFile(source, bytes);
  const target = path.join(dir, preview);
  try {
    return { id, name: displayName(upload.name), kind, file, preview, ...(await makePreview(source, kind, target)) };
  } catch (error) {
    await rm(source, { force: true });
    await rm(target, { force: true });
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw new BridgeStateError(`"${displayName(upload.name)}" could not be read as ${kind === "image" ? "an image" : "a video"} (${reason})`, 422);
  }
}

/** Write the JPEG Claude looks at: a downscaled image, or a contact sheet of a video's frames. */
async function makePreview(source: string, kind: "image" | "video", target: string): Promise<Pick<BoardReference, "duration" | "frames">> {
  if (kind === "image") {
    await runFfmpeg(
      ["-y", "-hide_banner", "-loglevel", "error", "-i", source, "-frames:v", "1", "-vf", `scale='min(${PREVIEW_WIDTH},iw)':-2`, "-q:v", "3", target],
      { timeoutMs: 60_000 },
    );
    return {};
  }
  const duration = await probeDuration(source);
  if (!duration || duration <= 0) throw new Error("could not read the video's duration");
  const { columns, rows, times } = sheetLayout(duration);
  const fps = (columns * rows) / duration;
  await runFfmpeg(
    [
      "-y", "-hide_banner", "-loglevel", "error", "-i", source,
      "-vf", `fps=${fps.toFixed(6)},scale=${SHEET_TILE_WIDTH}:-2,tile=${columns}x${rows}:padding=4:color=black`,
      "-frames:v", "1", "-q:v", "3", target,
    ],
    { timeoutMs: 120_000 },
  );
  return { duration: Number(duration.toFixed(2)), frames: times };
}

/**
 * Reference r<index> from a file in the media library (the New video wizard uploads references
 * there, so they have no size limit): only its preview is stored with the board.
 */
export async function saveReferenceFromMedia(boardId: string, index: number, mediaId: string): Promise<BoardReference> {
  const meta = await readMeta(mediaId);
  if (!meta) throw new BridgeStateError(`media/${mediaId} is not in the media library`, 400);
  const kind = mediaKindOf(meta);
  if (kind !== "image" && kind !== "video") throw new BridgeStateError(`"${meta.name}": references can be images or videos`, 400);
  const dir = referencesDir(boardId);
  await mkdir(dir, { recursive: true });
  const id = `r${index}`;
  const preview = `${id}.preview.jpg`;
  const target = path.join(dir, preview);
  try {
    const made = await makePreview(mediaPaths.source(mediaId, meta.ext), kind, target);
    const reference: BoardReference = { id, name: displayName(meta.name), kind, file: preview, preview, mediaId, ...made };
    // The reference seen in full: its sheets and strips are copied next to the board (the briefs and the autopilot read them there).
    try {
      const analysis = await ensureAnalysis(mediaId);
      if (!analysis) return reference;
      const copy = async (name: string) => {
        await copyFile(path.join(analysisDir(mediaId), name), path.join(dir, `${id}.${name}`));
        return `${id}.${name}`;
      };
      const sheets = [];
      for (const sheet of analysis.sheets) sheets.push({ ...sheet, file: await copy(sheet.file) });
      const strips = [];
      for (const strip of analysis.strips) strips.push({ ...strip, file: await copy(strip.file) });
      const { fps, width, height, cuts, shots, loudness } = analysis;
      return { ...reference, sheets, strips, analysis: { fps, width, height, cuts, shots, loudness } };
    } catch {
      return reference; // the one contact sheet still shows the look
    }
  } catch (error) {
    await rm(target, { force: true });
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw new BridgeStateError(`"${displayName(meta.name)}" could not be read as ${kind === "image" ? "an image" : "a video"} (${reason})`, 422);
  }
}

/** A reference file's bytes and type, for the editor (GET /api/bridge/boards/[id]/refs/[file]). */
export async function readReferenceFile(boardId: string, file: string): Promise<{ bytes: Buffer; type: string } | null> {
  const full = referenceFile(boardId, file);
  if (!full) return null;
  const info = await stat(full).catch(() => null);
  if (!info?.isFile()) return null;
  const ext = extensionOf(file);
  const type =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : IMAGE_EXTENSIONS.has(ext)
        ? `image/${ext}`
        : ext === "mov"
          ? "video/quicktime"
          : ext === "mkv"
            ? "video/x-matroska"
            : `video/${ext === "m4v" ? "mp4" : ext}`;
  return { bytes: await readFile(full), type };
}

export async function removeReferences(boardId: string): Promise<void> {
  await rm(referencesDir(boardId), { recursive: true, force: true });
}

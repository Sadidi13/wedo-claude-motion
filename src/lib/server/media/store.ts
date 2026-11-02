/**
 * Media library storage (docs/VIDEO.md). One folder per imported file under
 * `<repo>/.motion-media/<id>/` (override: MOTION_STUDIO_MEDIA_DIR):
 *
 *   source.<ext>   the file as imported (ffmpeg reads its sound for exports)
 *   meta.json      MediaMeta (state: processing → ready | error)
 *   preview.mp4    light H.264 copy the editor plays
 *   frames/        f_000000.jpg … one per 1/frameRate s, what exports draw
 *
 * Ids are 12 characters over [a-z0-9]; every path helper refuses anything else, so a request can
 * never reach outside the library.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { customAlphabet } from "nanoid";
import { MEDIA_ID_PATTERN, type MediaMeta } from "@/lib/media";
import { readJsonFile, writeJsonFile } from "../jsonFile";

const newId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 12);

export function newMediaId(): string {
  return newId();
}

export function isValidMediaId(id: string): boolean {
  return MEDIA_ID_PATTERN.test(id);
}

export function mediaRoot(): string {
  return process.env.MOTION_STUDIO_MEDIA_DIR || path.join(process.cwd(), ".motion-media");
}

/** Absolute folder of one media file. Throws for any id that does not match MEDIA_ID_PATTERN. */
export function mediaDir(id: string): string {
  if (!isValidMediaId(id)) throw new Error(`Invalid media id "${id}"`);
  return path.join(mediaRoot(), id);
}

export const mediaPaths = {
  meta: (id: string) => path.join(mediaDir(id), "meta.json"),
  source: (id: string, ext: string) => path.join(mediaDir(id), ext ? `source.${ext}` : "source"),
  preview: (id: string) => path.join(mediaDir(id), "preview.mp4"),
  frames: (id: string) => path.join(mediaDir(id), "frames"),
  frame: (id: string, n: number) => path.join(mediaDir(id), "frames", `f_${String(n).padStart(6, "0")}.jpg`),
};

export function readMeta(id: string): Promise<MediaMeta | null> {
  if (!isValidMediaId(id)) return Promise.resolve(null);
  return readJsonFile<MediaMeta>(mediaPaths.meta(id));
}

export function writeMeta(meta: MediaMeta): Promise<void> {
  return writeJsonFile(mediaPaths.meta(meta.id), meta);
}

/** Merge `patch` into the stored meta and return the result. */
export async function updateMeta(id: string, patch: Partial<MediaMeta>): Promise<MediaMeta> {
  const current = await readMeta(id);
  if (!current) throw new Error(`Media "${id}" does not exist`);
  const next = { ...current, ...patch };
  await writeMeta(next);
  return next;
}

/** Every imported file, newest first. */
export async function listMedia(): Promise<MediaMeta[]> {
  let names: string[];
  try {
    names = await readdir(mediaRoot());
  } catch {
    return [];
  }
  const metas = await Promise.all(names.filter(isValidMediaId).map((id) => readMeta(id).catch(() => null)));
  return metas.filter((m): m is MediaMeta => m !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

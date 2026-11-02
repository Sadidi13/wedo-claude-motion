/**
 * The fonts installed on this computer, for the editor's Fonts panel (docs/VIDEO.md, "Fonts").
 * Each TrueType / OpenType file in the system and user font folders is read just far enough for
 * its family, weight, style and whether it covers Arabic script; the list is cached in memory and
 * refreshed for files whose size or date changed. Using one copies its files into the media library,
 * so exports and other computers get the same font (`importInstalledFamily`).
 */

import { createHash } from "node:crypto";
import { copyFile, mkdir, open, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MediaMeta } from "@/lib/media";
import { readFontInfoFromFile, type FontInfo } from "../media/fontInfo";
import { ensureMediaReady, startIngest } from "../media/ingest";
import { mediaDir, mediaPaths, newMediaId, writeMeta } from "../media/store";

export interface InstalledFace {
  /** opaque id of the file (a hash of its path) */
  id: string;
  weight: number;
  style: "normal" | "italic";
  subfamily: string;
}

export interface InstalledFamily {
  family: string;
  arabic: boolean;
  faces: InstalledFace[];
}

const EXTENSIONS = new Set([".ttf", ".otf"]);
const MAX_FILES = 3_000;

/** The folders fonts are installed in on this platform. */
export function fontFolders(env: Record<string, string | undefined> = process.env, platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "win32") {
    return [path.join(env.WINDIR ?? env.SystemRoot ?? "C:\\Windows", "Fonts"), ...(env.LOCALAPPDATA ? [path.join(env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts")] : [])];
  }
  if (platform === "darwin") return ["/System/Library/Fonts", "/Library/Fonts", path.join(os.homedir(), "Library", "Fonts")];
  return ["/usr/share/fonts", "/usr/local/share/fonts", path.join(os.homedir(), ".local", "share", "fonts"), path.join(os.homedir(), ".fonts")];
}

async function fontFiles(folder: string, depth = 0, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) break;
    const full = path.join(folder, entry.name);
    if (entry.isDirectory() && depth < 3) await fontFiles(full, depth + 1, out);
    else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

async function infoOf(file: string): Promise<FontInfo | null> {
  const handle = await open(file, "r").catch(() => null);
  if (!handle) return null;
  try {
    return await readFontInfoFromFile(async (offset, length) => {
      const buffer = new Uint8Array(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return buffer.subarray(0, bytesRead);
    });
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

const faceId = (file: string) => createHash("sha256").update(file.toLowerCase()).digest("hex").slice(0, 16);

interface CachedFace extends FontInfo {
  file: string;
  size: number;
  mtimeMs: number;
}

const cache = new Map<string, CachedFace | null>();

/** Every installed family, the ones that cover Arabic script first, then by name. */
export async function listInstalledFonts(folders = fontFolders()): Promise<InstalledFamily[]> {
  const files = (await Promise.all(folders.map((folder) => fontFiles(folder)))).flat();
  const faces: CachedFace[] = [];
  for (const file of files) {
    const info = await stat(file).catch(() => null);
    if (!info) continue;
    const key = faceId(file);
    let face = cache.get(key);
    if (face === undefined || (face && (face.size !== info.size || face.mtimeMs !== info.mtimeMs))) {
      const read = await infoOf(file);
      face = read ? { ...read, file, size: info.size, mtimeMs: info.mtimeMs } : null;
      cache.set(key, face);
    }
    if (face) faces.push(face);
  }
  const families = new Map<string, InstalledFamily>();
  for (const face of faces) {
    const family = families.get(face.family) ?? { family: face.family, arabic: false, faces: [] };
    family.arabic ||= face.arabic;
    if (!family.faces.some((f) => f.weight === face.weight && f.style === face.style)) {
      family.faces.push({ id: faceId(face.file), weight: face.weight, style: face.style, subfamily: face.subfamily });
    }
    families.set(face.family, family);
  }
  for (const family of families.values()) family.faces.sort((a, b) => a.weight - b.weight || a.style.localeCompare(b.style));
  return [...families.values()].sort((a, b) => Number(b.arabic) - Number(a.arabic) || a.family.localeCompare(b.family));
}

/** One file per weight and style of a family (some families ship several files that all claim 900). */
function facesOf(family: string): CachedFace[] {
  const seen = new Set<string>();
  return [...cache.values()].filter((face): face is CachedFace => {
    if (face === null || face.family !== family || seen.has(`${face.weight}-${face.style}`)) return false;
    seen.add(`${face.weight}-${face.style}`);
    return true;
  });
}

/** Copy every face of an installed family into the media library; resolves with their (ready) metas. */
export async function importInstalledFamily(family: string): Promise<MediaMeta[]> {
  let faces = facesOf(family);
  if (faces.length === 0) {
    await listInstalledFonts();
    faces = facesOf(family);
  }
  if (faces.length === 0) throw new Error(`"${family}" is not installed on this computer`);
  const ids: string[] = [];
  for (const face of faces) {
    const ext = path.extname(face.file).slice(1).toLowerCase();
    const id = newMediaId();
    await mkdir(mediaDir(id), { recursive: true });
    await copyFile(face.file, mediaPaths.source(id, ext));
    await writeMeta({
      id,
      kind: "font",
      name: path.basename(face.file),
      ext,
      size: face.size,
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
    });
    await startIngest(id);
    ids.push(id);
  }
  return ensureMediaReady(ids);
}

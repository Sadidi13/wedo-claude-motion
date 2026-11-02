/**
 * A reference from a link (an Instagram reel, a YouTube video) downloaded into the media library
 * with yt-dlp, at most 1080p, then prepared like an upload (docs/VIDEO.md). The link is typed by the
 * designer in their own editor; yt-dlp runs with no config file, no cookies and no playlist, writes
 * only into the new file's folder, and is never given a local or private address.
 *
 * yt-dlp: MOTION_STUDIO_YTDLP, else `yt-dlp` on PATH. Without it the wizard asks for the file.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { mediaKindForName, type MediaMeta } from "@/lib/media";
import { ffmpegPath } from "../export/ffmpeg";
import { startIngest } from "./ingest";
import { mediaDir, mediaPaths, newMediaId, updateMeta, writeMeta } from "./store";

const DOWNLOAD_TIMEOUT_MS = 20 * 60_000;
/**
 * Best video and audio, preferring the largest whose smaller side is at most 1080 (`res` is the
 * smaller dimension, so a 1080x1920 reel qualifies; a height filter would drop it), then mp4 / m4a.
 */
const FORMAT = "bv*+ba/b";
const SORT = "res:1080,ext:mp4:m4a";

let found: string | null | undefined;

/** The yt-dlp executable, or null when this computer has none. */
export function ytDlpPath(env: Record<string, string | undefined> = process.env): string | null {
  if (env.MOTION_STUDIO_YTDLP) return existsSync(env.MOTION_STUDIO_YTDLP) ? env.MOTION_STUDIO_YTDLP : null;
  if (found !== undefined) return found;
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["yt-dlp"], { encoding: "utf8", windowsHide: true });
  found = probe.status === 0 ? (probe.stdout.split(/\r?\n/).find((line) => line.trim())?.trim() ?? null) : null;
  return found;
}

const PRIVATE_HOST = /^(?:localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[.*\])$/i;

/** The link as a URL yt-dlp may fetch: http(s) on a public host name, or an error message. */
export function checkLink(raw: string): URL | string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "That is not a link";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "Only http and https links can be downloaded";
  if (raw.length > 2_000) return "The link is too long";
  if (PRIVATE_HOST.test(url.hostname) || !url.hostname.includes(".")) return "Links to this computer or a local network are not downloaded";
  if (url.username || url.password) return "Links with a user name or password are not downloaded";
  return url;
}

/** yt-dlp's arguments for one download (pure, for tests). */
export function ytDlpArgs(url: string, dir: string, ffmpeg: string): string[] {
  return [
    "--ignore-config",
    "--no-playlist",
    "--no-cookies",
    "--no-cache-dir",
    "--no-mtime",
    "--no-part",
    "--no-progress",
    "--restrict-filenames",
    "--max-filesize", "2G",
    "-f", FORMAT,
    "-S", SORT,
    "--merge-output-format", "mp4",
    "--ffmpeg-location", ffmpeg,
    "-o", path.join(dir, "download.%(ext)s"),
    "--print", "before_dl:%(title).80s",
    "--",
    url,
  ];
}

function run(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("The download took longer than 20 minutes"));
    }, DOWNLOAD_TIMEOUT_MS);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr = (stderr + chunk).slice(-4_000)));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim().split(/\r?\n/).filter((line) => /error/i.test(line)).slice(-2).join(" ") || `yt-dlp exited with code ${code}`));
    });
  });
}

async function download(id: string, url: string, binary: string): Promise<void> {
  const dir = mediaDir(id);
  try {
    const stdout = await run(binary, ytDlpArgs(url, dir, ffmpegPath()));
    const file = (await readdir(dir)).find((name) => name.startsWith("download."));
    if (!file) throw new Error("yt-dlp wrote no file");
    const ext = file.slice("download.".length).toLowerCase();
    if (mediaKindForName(file) !== "video") throw new Error(`The download is not a video (${ext})`);
    await rename(path.join(dir, file), mediaPaths.source(id, ext));
    const title = stdout.split(/\r?\n/).find((line) => line.trim())?.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ") || new URL(url).hostname;
    const { size } = await stat(mediaPaths.source(id, ext));
    await updateMeta(id, { ext, size, name: `${title.slice(0, 100)}.${ext}` });
    void startIngest(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateMeta(id, { state: "error", error: `Could not download the link: ${message}`.slice(0, 600) }).catch(() => undefined);
    for (const name of await readdir(dir).catch(() => [])) if (name.startsWith("download.")) await rm(path.join(dir, name), { force: true });
  }
}

/** Start downloading `url` into a new library file; resolves at once with its (processing) meta. */
export async function importFromLink(raw: string): Promise<MediaMeta> {
  const url = checkLink(raw);
  if (typeof url === "string") throw new Error(url);
  const binary = ytDlpPath();
  if (!binary) throw new Error("yt-dlp is not installed on this computer: download the video yourself and add the file");
  const id = newMediaId();
  await mkdir(mediaDir(id), { recursive: true });
  const meta: MediaMeta = {
    id,
    kind: "video",
    name: `${url.hostname}.mp4`,
    ext: "mp4",
    size: 0,
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
  void download(id, url.toString(), binary);
  return meta;
}

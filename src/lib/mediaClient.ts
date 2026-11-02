/**
 * Browser side of the media library (docs/VIDEO.md): upload a file to the local server, wait until
 * it is ready, and work with its Whisper transcript. XMLHttpRequest rather than fetch for uploads,
 * for upload progress.
 */

import { mediaUrls, type MediaMeta, type TranscriptStatus } from "@/lib/media";

export type UploadedMedia = MediaMeta & { ref: string };

/** POST the file as a raw body; `onProgress` gets 0..1. Rejects with the server's message. */
export function uploadMedia(file: File, onProgress?: (fraction: number) => void): Promise<UploadedMedia> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media/upload");
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onerror = () => reject(new Error("The upload failed (is the Motion Studio server running?)"));
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // not JSON
      }
      if (xhr.status === 201 && body) resolve(body as UploadedMedia);
      else reject(new Error((body as { error?: string } | null)?.error ?? `The upload failed (HTTP ${xhr.status})`));
    };
    xhr.send(file);
  });
}

/** Footage upload (the layers panel's Video button). */
export const uploadVideo = uploadMedia;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchMedia(id: string): Promise<UploadedMedia> {
  const response = await fetch(mediaUrls.meta(id), { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not read the file's details (HTTP ${response.status})`);
  return (await response.json()) as UploadedMedia;
}

/**
 * Poll the file's metadata until its length is known (the server reads it first, in about a
 * second) or it failed. Frames may still be in the works: <Video> shows a placeholder until then.
 */
export async function waitForLength(id: string, timeoutMs = 60_000): Promise<MediaMeta> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const meta = await fetchMedia(id);
    if (meta.state === "error") throw new Error(meta.error ?? "The video could not be prepared");
    if (meta.duration > 0 || meta.state === "ready") return meta;
    if (Date.now() > until) throw new Error("The server took too long to read the video");
    await sleep(500);
  }
}

/** Poll until the file is ready (a video's frames are written) or failed. */
export async function waitForReady(id: string, onUpdate?: (meta: UploadedMedia) => void, timeoutMs = 60 * 60_000): Promise<UploadedMedia> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const meta = await fetchMedia(id);
    onUpdate?.(meta);
    if (meta.state === "error") throw new Error(meta.error ?? "The file could not be prepared");
    if (meta.state === "ready") return meta;
    if (Date.now() > until) throw new Error("The server took too long to prepare the file");
    await sleep(1500);
  }
}

export interface TranscriptSegmentView {
  start: number;
  end: number;
  text: string;
  edited?: boolean;
}

export interface TranscriptView {
  status: TranscriptStatus | null;
  transcript: { language: string; segments: TranscriptSegmentView[] } | null;
  /** Whisper is set up on this computer */
  available: boolean;
  canTranscribe: boolean;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
  return body as T;
}

export async function getTranscript(id: string): Promise<TranscriptView> {
  return readJson<TranscriptView>(await fetch(mediaUrls.transcript(id), { cache: "no-store" }));
}

/** Start Whisper on the file; `language` is a hint like "fa". */
export async function startTranscript(id: string, language?: string): Promise<void> {
  await readJson(
    await fetch(mediaUrls.transcript(id), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(language ? { language } : {}),
    }),
  );
}

/** Download a video from a link (yt-dlp on the server); resolves with its meta while it downloads. */
export async function importLink(url: string): Promise<UploadedMedia> {
  return readJson<UploadedMedia>(
    await fetch("/api/media/import-url", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) }),
  );
}

export interface AnalysisView {
  status: { state: "processing" | "ready" | "error"; error?: string } | null;
  analysis: { kind: "video" | "image"; duration: number; cuts: number[]; shots: unknown[]; sheets: { file: string }[]; strips: { file: string }[] } | null;
}

/** Measure a reference (contact sheets, cuts, colours, loudness) on the server, then poll until done. */
export async function analyseReference(id: string, onUpdate?: (view: AnalysisView) => void): Promise<AnalysisView> {
  await readJson(await fetch(mediaUrls.analysis(id), { method: "POST" }));
  for (;;) {
    const view = await readJson<AnalysisView>(await fetch(mediaUrls.analysis(id), { cache: "no-store" }));
    onUpdate?.(view);
    if (view.status?.state !== "processing") return view;
    await sleep(1500);
  }
}

/** Save the designer's corrections, one text per segment. */
export async function saveTranscript(id: string, texts: string[]): Promise<void> {
  await readJson(
    await fetch(mediaUrls.transcript(id), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ texts }) }),
  );
}

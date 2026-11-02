/**
 * Browser side of the media library (docs/VIDEO.md): upload a video to the local server and wait
 * for its length. XMLHttpRequest rather than fetch, for upload progress.
 */

import { mediaUrls, type MediaMeta } from "@/lib/media";

export type UploadedMedia = MediaMeta & { ref: string };

/** POST the file as a raw body; `onProgress` gets 0..1. Rejects with the server's message. */
export function uploadVideo(file: File, onProgress?: (fraction: number) => void): Promise<UploadedMedia> {
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll the file's metadata until its length is known (the server reads it first, in about a
 * second) or it failed. Frames may still be in the works: <Video> shows a placeholder until then.
 */
export async function waitForLength(id: string, timeoutMs = 60_000): Promise<MediaMeta> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const response = await fetch(mediaUrls.meta(id), { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not read the video's details (HTTP ${response.status})`);
    const meta = (await response.json()) as MediaMeta;
    if (meta.state === "error") throw new Error(meta.error ?? "The video could not be prepared");
    if (meta.duration > 0 || meta.state === "ready") return meta;
    if (Date.now() > until) throw new Error("The server took too long to read the video");
    await sleep(500);
  }
}

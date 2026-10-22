/**
 * Binary ⇄ `data:` URL helpers and MIME detection by file extension.
 *
 * Project assets are stored as base64 data URLs (see ProjectFile.content), so
 * the importer encodes zip entries on the way in and decodes them on the way
 * out. Isomorphic: uses the `btoa` / `atob` globals (browsers and Node ≥ 16)
 * instead of Buffer.
 */

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
};

const OCTET_STREAM = "application/octet-stream";

/** Lower-case extension without the dot ("assets/Logo.PNG" → "png"); "" when there is none. */
export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

/** True for image / video / audio / font files that become `kind: "asset"` wherever they live. */
export function isAssetPath(path: string): boolean {
  return extensionOf(path) in MIME_BY_EXTENSION;
}

/** MIME type for a file path; `application/octet-stream` for unknown extensions. */
export function mimeTypeFor(path: string): string {
  return MIME_BY_EXTENSION[extensionOf(path)] ?? OCTET_STREAM;
}

/** Chunked so very large files do not blow the argument limit of String.fromCharCode. */
const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

export interface DecodedDataUrl {
  mime: string;
  bytes: Uint8Array;
}

/** Decode a `data:` URL (base64 or percent-encoded payload). Throws on anything else. */
export function dataUrlToBytes(dataUrl: string): DecodedDataUrl {
  const match = /^data:([^,]*?)(;base64)?,([\s\S]*)$/i.exec(dataUrl);
  if (!match) throw new Error("Not a data: URL");
  const [, header, base64Flag, payload] = match;
  const mime = header.split(";")[0] || "text/plain";
  if (base64Flag) return { mime, bytes: base64ToBytes(payload) };
  return { mime, bytes: new TextEncoder().encode(decodeURIComponent(payload)) };
}

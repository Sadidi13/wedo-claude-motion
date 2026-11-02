/**
 * The family, weight and style a font file declares, read from its `name` and `OS/2` tables, so a
 * font from the media library can be used in CSS under its own name (docs/VIDEO.md). TrueType /
 * OpenType (sfnt), WOFF (zlib-compressed tables) and WOFF2 (one brotli stream) are read; font
 * collections (.ttc) are not. Pure: bytes in, info out.
 */

import { brotliDecompressSync, inflateSync } from "node:zlib";

export interface FontInfo {
  family: string;
  /** "Bold", "Regular", "Light Italic", … */
  subfamily: string;
  /** usWeightClass, 100-900 */
  weight: number;
  style: "normal" | "italic";
  /** the OS/2 table says it covers Arabic script (Persian text) */
  arabic: boolean;
}

type Tables = Map<string, Uint8Array>;

const tagAt = (bytes: Uint8Array, offset: number) => String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function slice(bytes: Uint8Array, offset: number, length: number): Uint8Array | null {
  return offset >= 0 && length >= 0 && offset + length <= bytes.length ? bytes.subarray(offset, offset + length) : null;
}

/** The tables of a plain sfnt (TrueType / OpenType). */
function sfntTables(bytes: Uint8Array, wanted: readonly string[]): Tables {
  const tables: Tables = new Map();
  const data = view(bytes);
  const count = data.getUint16(4);
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16;
    if (record + 16 > bytes.length) break;
    const tag = tagAt(bytes, record);
    if (!wanted.includes(tag)) continue;
    const table = slice(bytes, data.getUint32(record + 8), data.getUint32(record + 12));
    if (table) tables.set(tag, table);
  }
  return tables;
}

/** WOFF 1.0: a directory of tables, each zlib-compressed when that makes it smaller. */
function woffTables(bytes: Uint8Array, wanted: readonly string[]): Tables {
  const tables: Tables = new Map();
  const data = view(bytes);
  const count = data.getUint16(12);
  for (let i = 0; i < count; i++) {
    const entry = 44 + i * 20;
    if (entry + 20 > bytes.length) break;
    const tag = tagAt(bytes, entry);
    if (!wanted.includes(tag)) continue;
    const stored = slice(bytes, data.getUint32(entry + 4), data.getUint32(entry + 8));
    const length = data.getUint32(entry + 12);
    if (!stored) continue;
    tables.set(tag, stored.length < length ? new Uint8Array(inflateSync(stored)) : stored);
  }
  return tables;
}

/** The tags WOFF2 numbers 0-62 (its "known tags"); 63 means the tag follows in the directory. */
const WOFF2_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
  "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH",
  "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
  "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

/** UIntBase128 at `offset`: [value, bytes read], or null when malformed. */
function base128(bytes: Uint8Array, offset: number): [number, number] | null {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = bytes[offset + i];
    if (byte === undefined || (i === 0 && byte === 0x80) || value > 0x01ffffff) return null;
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value, i + 1];
  }
  return null;
}

/** WOFF 2.0: a compact directory, then every table in one brotli stream (name and OS/2 are never transformed). */
function woff2Tables(bytes: Uint8Array, wanted: readonly string[]): Tables {
  const tables: Tables = new Map();
  const data = view(bytes);
  if (tagAt(bytes, 4) === "ttcf") return tables;
  const count = data.getUint16(12);
  const compressedSize = data.getUint32(20);
  const entries: { tag: string; length: number }[] = [];
  let offset = 48;
  for (let i = 0; i < count; i++) {
    const flags = bytes[offset++];
    if (flags === undefined) return tables;
    let tag: string;
    if ((flags & 0x3f) === 63) {
      if (offset + 4 > bytes.length) return tables;
      tag = tagAt(bytes, offset);
      offset += 4;
    } else {
      tag = WOFF2_TAGS[flags & 0x3f];
    }
    const original = base128(bytes, offset);
    if (!original) return tables;
    offset += original[1];
    let length = original[0];
    const version = flags >> 6;
    const transformed = tag === "glyf" || tag === "loca" ? version !== 3 : version !== 0;
    if (transformed) {
      const transform = base128(bytes, offset);
      if (!transform) return tables;
      offset += transform[1];
      length = transform[0];
    }
    entries.push({ tag, length });
  }
  const compressed = slice(bytes, offset, compressedSize);
  if (!compressed) return tables;
  const stream = new Uint8Array(brotliDecompressSync(compressed));
  let position = 0;
  for (const { tag, length } of entries) {
    if (wanted.includes(tag)) {
      const table = slice(stream, position, length);
      if (table) tables.set(tag, table);
    }
    position += length;
  }
  return tables;
}

function decodeName(bytes: Uint8Array, platform: number): string {
  if (platform === 1) return Array.from(bytes, (b) => String.fromCharCode(b)).join(""); // Mac Roman, ASCII part
  let text = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) text += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  return text;
}

/** Name `id`, preferring Windows / Unicode English entries. */
function nameRecord(table: Uint8Array, id: number): string | null {
  const data = view(table);
  if (table.length < 6) return null;
  const count = data.getUint16(2);
  const strings = data.getUint16(4);
  let best: { score: number; text: string } | null = null;
  for (let i = 0; i < count; i++) {
    const record = 6 + i * 12;
    if (record + 12 > table.length) break;
    if (data.getUint16(record + 6) !== id) continue;
    const platform = data.getUint16(record);
    const encoding = data.getUint16(record + 2);
    const language = data.getUint16(record + 4);
    const bytes = slice(table, strings + data.getUint16(record + 10), data.getUint16(record + 8));
    if (!bytes) continue;
    let score: number;
    if (platform === 3 && (encoding === 1 || encoding === 10)) score = language === 0x0409 ? 4 : 3;
    else if (platform === 0) score = 2;
    else if (platform === 1 && encoding === 0) score = language === 0 ? 1 : 0;
    else continue;
    const text = decodeName(bytes, platform).replace(/\u0000/g, "").trim();
    if (text && (!best || score > best.score)) best = { score, text };
  }
  return best?.text ?? null;
}

/** The font's family, subfamily, weight and style; null when the bytes are not a font this reads. */
export function readFontInfo(bytes: Uint8Array): FontInfo | null {
  if (bytes.length < 48) return null;
  const signature = tagAt(bytes, 0);
  const wanted = ["name", "OS/2"] as const;
  let tables: Tables;
  try {
    if (signature === "wOFF") tables = woffTables(bytes, wanted);
    else if (signature === "wOF2") tables = woff2Tables(bytes, wanted);
    else if (signature === "\u0000\u0001\u0000\u0000" || signature === "OTTO" || signature === "true") tables = sfntTables(bytes, wanted);
    else return null;
  } catch {
    return null;
  }
  const name = tables.get("name");
  if (!name) return null;
  const family = nameRecord(name, 16) ?? nameRecord(name, 1);
  if (!family) return null;
  const subfamily = nameRecord(name, 17) ?? nameRecord(name, 2) ?? "Regular";
  const os2 = tables.get("OS/2");
  let weight = /bold/i.test(subfamily) ? 700 : 400;
  let italic = /italic|oblique/i.test(subfamily);
  let arabic = false;
  if (os2 && os2.length >= 64) {
    const data = view(os2);
    const declared = data.getUint16(4);
    if (declared >= 1 && declared <= 1000) weight = declared;
    italic = italic || (data.getUint16(62) & 1) === 1;
    arabic = (data.getUint32(42) & (1 << 13)) !== 0; // ulUnicodeRange1 bit 13: Arabic
  }
  return { family: family.slice(0, 80), subfamily: subfamily.slice(0, 80), weight, style: italic ? "italic" : "normal", arabic };
}

/**
 * The same, reading only the font's table directory, `name` and `OS/2` from disk (a TrueType or
 * OpenType file; null for anything else), so a folder of hundreds of system fonts lists quickly.
 */
export async function readFontInfoFromFile(read: (offset: number, length: number) => Promise<Uint8Array>): Promise<FontInfo | null> {
  const header = await read(0, 12);
  if (header.length < 12) return null;
  const signature = tagAt(header, 0);
  if (signature !== "\u0000\u0001\u0000\u0000" && signature !== "OTTO" && signature !== "true") return null;
  const count = view(header).getUint16(4);
  if (count === 0 || count > 200) return null;
  const directory = await read(12, count * 16);
  const records = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < count && (i + 1) * 16 <= directory.length; i++) {
    const tag = tagAt(directory, i * 16);
    if (tag === "name" || tag === "OS/2") records.set(tag, { offset: view(directory).getUint32(i * 16 + 8), length: view(directory).getUint32(i * 16 + 12) });
  }
  const name = records.get("name");
  if (!name || name.length > 1_000_000) return null;
  const tables: [string, Uint8Array][] = [["name", await read(name.offset, name.length)]];
  const os2 = records.get("OS/2");
  if (os2 && os2.length <= 1024) tables.push(["OS/2", await read(os2.offset, os2.length)]);
  // A minimal sfnt holding just those tables, for readFontInfo.
  let offset = 12 + tables.length * 16;
  const out = new Uint8Array(offset + tables.reduce((sum, [, table]) => sum + table.length, 0));
  const data = view(out);
  data.setUint32(0, 0x00010000);
  data.setUint16(4, tables.length);
  tables.forEach(([tag, table], i) => {
    for (let k = 0; k < 4; k++) out[12 + i * 16 + k] = tag.charCodeAt(k);
    data.setUint32(12 + i * 16 + 8, offset);
    data.setUint32(12 + i * 16 + 12, table.length);
    out.set(table, offset);
    offset += table.length;
  });
  return readFontInfo(out);
}

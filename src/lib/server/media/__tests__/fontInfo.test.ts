import { brotliCompressSync, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readFontInfo, readFontInfoFromFile } from "../fontInfo";

/** A `name` table with Windows (UTF-16BE) records. */
function nameTable(records: [nameId: number, text: string][]): Uint8Array {
  const strings: number[] = [];
  const entries = records.map(([nameId, text]) => {
    const offset = strings.length;
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      strings.push(code >> 8, code & 0xff);
    }
    return { nameId, offset, length: text.length * 2 };
  });
  const header = 6 + entries.length * 12;
  const table = new Uint8Array(header + strings.length);
  const view = new DataView(table.buffer);
  view.setUint16(0, 0);
  view.setUint16(2, entries.length);
  view.setUint16(4, header);
  entries.forEach((entry, i) => {
    const at = 6 + i * 12;
    view.setUint16(at, 3); // Windows
    view.setUint16(at + 2, 1); // Unicode BMP
    view.setUint16(at + 4, 0x0409); // English
    view.setUint16(at + 6, entry.nameId);
    view.setUint16(at + 8, entry.length);
    view.setUint16(at + 10, entry.offset);
  });
  table.set(strings, header);
  return table;
}

/** An `OS/2` table with the weight class, the italic bit and (optionally) the Arabic range bit. */
function os2Table(weight: number, italic: boolean, arabic = false): Uint8Array {
  const table = new Uint8Array(96);
  const view = new DataView(table.buffer);
  view.setUint16(4, weight);
  if (arabic) view.setUint32(42, 1 << 13);
  view.setUint16(62, italic ? 1 : 0x40);
  return table;
}

const tag = (text: string) => [...text].map((c) => c.charCodeAt(0));

function sfnt(tables: [string, Uint8Array][]): Uint8Array {
  let offset = 12 + tables.length * 16;
  const out = new Uint8Array(offset + tables.reduce((sum, [, t]) => sum + t.length + 4, 0));
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, tables.length);
  tables.forEach(([name, table], i) => {
    const record = 12 + i * 16;
    out.set(tag(name), record);
    view.setUint32(record + 8, offset);
    view.setUint32(record + 12, table.length);
    out.set(table, offset);
    offset += table.length + 4;
  });
  return out;
}

function woff(tables: [string, Uint8Array][]): Uint8Array {
  const compressed = tables.map(([name, table]) => [name, deflateSync(table), table.length] as const);
  let offset = 44 + tables.length * 20;
  const out = new Uint8Array(offset + compressed.reduce((sum, [, data]) => sum + data.length, 0));
  const view = new DataView(out.buffer);
  out.set(tag("wOFF"), 0);
  view.setUint16(12, tables.length);
  compressed.forEach(([name, data, length], i) => {
    const entry = 44 + i * 20;
    out.set(tag(name), entry);
    view.setUint32(entry + 4, offset);
    view.setUint32(entry + 8, data.length);
    view.setUint32(entry + 12, length);
    out.set(data, offset);
    offset += data.length;
  });
  return out;
}

/** WOFF2 with known-tag entries (no transforms) and one brotli stream. */
function woff2(tables: [knownTag: number, Uint8Array][]): Uint8Array {
  const directory: number[] = [];
  for (const [known, table] of tables) {
    directory.push(known);
    let length = table.length;
    const bytes: number[] = [];
    do {
      bytes.unshift(length & 0x7f);
      length >>= 7;
    } while (length > 0);
    directory.push(...bytes.map((b, i) => (i < bytes.length - 1 ? b | 0x80 : b)));
  }
  const stream = Buffer.concat(tables.map(([, table]) => Buffer.from(table)));
  const compressed = brotliCompressSync(stream);
  const out = new Uint8Array(48 + directory.length + compressed.length);
  const view = new DataView(out.buffer);
  out.set(tag("wOF2"), 0);
  out.set([0, 1, 0, 0], 4);
  view.setUint16(12, tables.length);
  view.setUint32(20, compressed.length);
  out.set(directory, 48);
  out.set(compressed, 48 + directory.length);
  return out;
}

const NAME = nameTable([
  [1, "Brand Sans Bold"],
  [2, "Regular"],
  [16, "Brand Sans"],
  [17, "Bold"],
]);

describe("readFontInfo", () => {
  it("reads the typographic family, weight and style of a TrueType / OpenType font", () => {
    expect(readFontInfo(sfnt([["name", NAME], ["OS/2", os2Table(700, false)]]))).toEqual({
      family: "Brand Sans",
      subfamily: "Bold",
      weight: 700,
      style: "normal",
      arabic: false,
    });
    expect(readFontInfo(sfnt([["name", NAME], ["OS/2", os2Table(400, false, true)]]))?.arabic).toBe(true);
  });

  it("falls back to the legacy family and guesses the weight without an OS/2 table", () => {
    const name = nameTable([
      [1, "Vazir"],
      [2, "Bold Italic"],
    ]);
    expect(readFontInfo(sfnt([["name", name]]))).toEqual({ family: "Vazir", subfamily: "Bold Italic", weight: 700, style: "italic", arabic: false });
  });

  it("reads only the tables it needs from a file", async () => {
    const bytes = sfnt([["glyf", new Uint8Array(5000)], ["name", NAME], ["OS/2", os2Table(900, false, true)]]);
    const reads: [number, number][] = [];
    const info = await readFontInfoFromFile(async (offset, length) => {
      reads.push([offset, length]);
      return bytes.subarray(offset, offset + length);
    });
    expect(info).toMatchObject({ family: "Brand Sans", weight: 900, arabic: true });
    expect(reads.reduce((sum, [, length]) => sum + length, 0)).toBeLessThan(1000);
  });

  it("reads WOFF (zlib tables) and WOFF2 (one brotli stream)", () => {
    expect(readFontInfo(woff([["OS/2", os2Table(300, true)], ["name", NAME]]))).toMatchObject({ family: "Brand Sans", weight: 300, style: "italic" });
    // known tags: 5 = name, 6 = OS/2, 7 = post
    expect(readFontInfo(woff2([[7, new Uint8Array(32)], [5, NAME], [6, os2Table(900, false)]]))).toMatchObject({ family: "Brand Sans", weight: 900 });
  });

  it("returns null for anything that is not a font it can read", () => {
    expect(readFontInfo(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>".padEnd(64, " ")))).toBeNull();
    expect(readFontInfo(new Uint8Array(10))).toBeNull();
    expect(readFontInfo(sfnt([["OS/2", os2Table(400, false)]]))).toBeNull();
  });
});

/**
 * Fonts in a project (the editor's Fonts panel, docs/VIDEO.md): faces from the media library are
 * declared in the project's `fonts.css`, which the entry file imports; a role in the scene's FONTS
 * table then names the family. "All text" is one marked rule that overrides every element on the
 * stage, for scenes without a FONTS table. Pure string helpers, shared by the editor and tests.
 */

export const FONTS_CSS = "fonts.css";

export interface FontFace {
  family: string;
  /** `media/<id>.<ext>` */
  ref: string;
  weight: number;
  style: "normal" | "italic";
}

/** A free Persian / Latin web font, loaded from Google Fonts (exports may load other origins). */
export const WEB_FONTS: { family: string; css: string; note: string }[] = [
  { family: "Vazirmatn", css: "https://fonts.googleapis.com/css2?family=Vazirmatn:wght@100..900&display=swap", note: "Persian and Latin, 100-900" },
];

const ALL_START = "/* motion-studio: all text */";
const ALL_END = "/* end: all text */";

const quote = (family: string) => JSON.stringify(family);

/** The CSS font-family value for a role: the family, then a fallback stack. */
export function familyValue(family: string, fallback = "sans-serif"): string {
  return `${quote(family)}, ${fallback}`;
}

/** The first family named in a font-family value ("Peyda" for `"Peyda", sans-serif`). */
export function firstFamily(value: string): string {
  const first = value.split(",")[0]?.trim() ?? "";
  return first.replace(/^["']|["']$/g, "");
}

/** `css` with an @font-face rule for every face whose file it does not declare yet. */
export function withFontFaces(css: string, faces: FontFace[]): string {
  const rules = faces
    .filter((face) => !css.includes(face.ref))
    .map((face) => `@font-face { font-family: ${quote(face.family)}; src: url("${face.ref}"); font-weight: ${face.weight}; font-style: ${face.style}; font-display: block; }`);
  if (rules.length === 0) return css;
  return `${css.trimEnd()}${css.trim() ? "\n" : ""}${rules.join("\n")}\n`;
}

/** `css` with an @import of a web font's stylesheet first (CSS needs @import before other rules). */
export function withCssImport(css: string, url: string): string {
  if (css.includes(url)) return css;
  return `@import url(${JSON.stringify(url)});\n${css}`;
}

/** `css` with the "all text" rule set to `family` (null removes it). */
export function withAllTextFont(css: string, family: string | null): string {
  const start = css.indexOf(ALL_START);
  const end = css.indexOf(ALL_END);
  const without = start >= 0 && end > start ? `${css.slice(0, start).trimEnd()}\n${css.slice(end + ALL_END.length).trimStart()}`.trim() : css.trim();
  if (family === null) return without ? `${without}\n` : "";
  const rule = `${ALL_START}\n[data-stage] * { font-family: ${familyValue(family)} !important; }\n${ALL_END}`;
  return `${without ? `${without}\n` : ""}${rule}\n`;
}

/** The family the "all text" rule sets, or null. */
export function allTextFont(css: string): string | null {
  const start = css.indexOf(ALL_START);
  if (start < 0) return null;
  const match = /font-family:\s*([^;!]+)/.exec(css.slice(start));
  return match ? firstFamily(match[1]) : null;
}

import { describe, expect, it } from "vitest";
import { allTextFont, familyValue, firstFamily, withAllTextFont, withCssImport, withFontFaces } from "../fonts";

const BOLD = { family: "Peyda", ref: "media/aaaaaaaaaaaa.ttf", weight: 700, style: "normal" as const };
const REGULAR = { family: "Peyda", ref: "media/bbbbbbbbbbbb.ttf", weight: 400, style: "normal" as const };

describe("fonts.css", () => {
  it("declares each face once", () => {
    const css = withFontFaces("", [BOLD]);
    expect(css).toBe('@font-face { font-family: "Peyda"; src: url("media/aaaaaaaaaaaa.ttf"); font-weight: 700; font-style: normal; font-display: block; }\n');
    const both = withFontFaces(css, [BOLD, REGULAR]);
    expect(both.match(/@font-face/g)).toHaveLength(2);
    expect(withFontFaces(both, [BOLD, REGULAR])).toBe(both);
  });

  it("puts a web font's @import first", () => {
    const css = withCssImport(withFontFaces("", [BOLD]), "https://fonts.googleapis.com/css2?family=Vazirmatn");
    expect(css.startsWith('@import url("https://fonts.googleapis.com/css2?family=Vazirmatn");\n@font-face')).toBe(true);
  });

  it("sets, reads, replaces and removes the all-text rule", () => {
    const set = withAllTextFont(withFontFaces("", [BOLD]), "Peyda");
    expect(set).toContain('[data-stage] * { font-family: "Peyda", sans-serif !important; }');
    expect(allTextFont(set)).toBe("Peyda");
    const changed = withAllTextFont(set, "Vazirmatn");
    expect(allTextFont(changed)).toBe("Vazirmatn");
    expect(changed.match(/motion-studio: all text/g)).toHaveLength(1);
    const removed = withAllTextFont(changed, null);
    expect(allTextFont(removed)).toBeNull();
    expect(removed).toContain("@font-face");
  });

  it("reads and writes font-family values", () => {
    expect(familyValue("IRANYekanX")).toBe('"IRANYekanX", sans-serif');
    expect(firstFamily('"Peyda", "Vazirmatn", sans-serif')).toBe("Peyda");
    expect(firstFamily("system-ui, sans-serif")).toBe("system-ui");
  });
});

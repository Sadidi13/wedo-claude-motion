/** Pure string helpers: edit batching, re-indentation, number formatting. */
import { describe, expect, it } from "vitest";
import { applyEdits, formatNumber, indentAt, reindent, startsLine } from "../text";

describe("applyEdits", () => {
  it("applies edits back-to-front and keeps same-offset insertions in array order", () => {
    const src = "<Sprite>";
    const out = applyEdits(src, [
      { start: 7, end: 7, text: ' start={1}' },
      { start: 7, end: 7, text: ' end={2}' },
      { start: 1, end: 7, text: "Foo" },
    ]);
    expect(out).toBe("<Foo start={1} end={2}>");
  });

  it("rejects overlapping edits", () => {
    expect(() => applyEdits("abcdef", [{ start: 0, end: 3, text: "" }, { start: 2, end: 4, text: "" }])).toThrow(/Overlapping/);
  });
});

describe("reindent", () => {
  it("re-bases every line after the first onto the given indent", () => {
    const snippet = "  <div>\n      <p>a</p>\n\n    </div>  ";
    expect(reindent(snippet, "\t")).toBe("<div>\n\t  <p>a</p>\n\n\t</div>");
    expect(reindent("<br/>", "    ")).toBe("<br/>");
  });
});

describe("formatNumber / line helpers", () => {
  it("writes at most 3 decimals without trailing zeros", () => {
    expect(formatNumber(4)).toBe("4");
    expect(formatNumber(1.5)).toBe("1.5");
    expect(formatNumber(2.123456)).toBe("2.123");
    expect(formatNumber(-0.5)).toBe("-0.5");
    expect(formatNumber(Infinity)).toBe("Infinity");
    expect(() => formatNumber(Number.NaN)).toThrow();
  });

  it("finds indentation and line starts", () => {
    const src = "a\n    <b/> x\n\t<c/>";
    expect(indentAt(src, src.indexOf("<b"))).toBe("    ");
    expect(indentAt(src, src.indexOf("<c"))).toBe("\t");
    expect(startsLine(src, src.indexOf("<b"))).toBe(true);
    expect(startsLine(src, src.indexOf("x"))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { parseScene } from "../scene";
import { ensureSideEffectImport, readJsxTexts, readSceneTables, setJsxText, setTableValue, setTableValues } from "../textTable";

const SCENE = `import React from "react";
import { Stage, Sprite } from "./animations.jsx";

const TEXT = {
  title: "مدل بی‌نظیر سورا ۲",
  points: ["رایگان", \`ویدیو از متن\`],
  cta: { label: "Follow" },
} as const;

const FONTS = { display: '"Peyda", sans-serif', body: "system-ui" };

export default function Scene() {
  return (
    <Stage width={1080} height={1920} duration={4} fps={30}>
      <Sprite start={0} end={4} data-layer-id="title-sprite">
        <h1 data-layer-id="title" style={{ fontFamily: FONTS.display }}>{TEXT.title}</h1>
      </Sprite>
      <Sprite start={1} end={4} data-layer-id="note">
        <p data-layer-id="note-text">Made with &amp; love</p>
      </Sprite>
      <Sprite start={2} end={4} data-layer-id="literal">
        <span data-layer-id="literal-text" title="not this">{"Literal words"}</span>
      </Sprite>
    </Stage>
  );
}
`;

describe("readSceneTables", () => {
  it("finds every string of TEXT and FONTS, nested and in arrays, with dotted keys", () => {
    const { TEXT, FONTS } = readSceneTables(SCENE);
    expect(TEXT?.map((e) => [e.key, e.value])).toEqual([
      ["title", "مدل بی‌نظیر سورا ۲"],
      ["points.0", "رایگان"],
      ["points.1", "ویدیو از متن"],
      ["cta.label", "Follow"],
    ]);
    expect(FONTS?.map((e) => [e.key, e.value])).toEqual([
      ["display", '"Peyda", sans-serif'],
      ["body", "system-ui"],
    ]);
    expect(readSceneTables("const x = 1;")).toEqual({ TEXT: null, FONTS: null });
  });
});

describe("setTableValue", () => {
  it("replaces one literal with a JSON string, whatever the text holds", () => {
    const next = setTableValue(SCENE, "TEXT", "title", 'Say "hi"\nthen go');
    expect(next).toContain('title: "Say \\"hi\\"\\nthen go",');
    expect(readSceneTables(next).TEXT?.[0].value).toBe('Say "hi"\nthen go');
    expect(setTableValue(SCENE, "TEXT", "points.1", "متن به ویدیو")).toContain('points: ["رایگان", "متن به ویدیو"]');
    expect(setTableValue(SCENE, "FONTS", "display", '"Vazirmatn", sans-serif')).toContain(`display: "\\"Vazirmatn\\", sans-serif"`);
    expect(() => setTableValue(SCENE, "TEXT", "missing", "x")).toThrow(/TEXT.missing/);
  });

  it("applies several changes at once and reports the unknown keys", () => {
    const { source, missing } = setTableValues(SCENE, [
      { table: "TEXT", key: "cta.label", value: "دنبال کن" },
      { table: "FONTS", key: "body", value: '"Vazirmatn"' },
      { table: "TEXT", key: "nope", value: "x" },
    ]);
    const tables = readSceneTables(source);
    expect(tables.TEXT?.find((e) => e.key === "cta.label")?.value).toBe("دنبال کن");
    expect(tables.FONTS?.find((e) => e.key === "body")?.value).toBe('"Vazirmatn"');
    expect(missing).toEqual(["TEXT.nope"]);
  });
});

describe("layer names", () => {
  it("show the words of {TEXT.key}", () => {
    expect(parseScene(SCENE).byId.title.textPreview).toBe("مدل بی‌نظیر سورا ۲");
  });
});

describe("plain JSX text", () => {
  it("lists text written between tags and string literals in braces, not attributes", () => {
    const texts = readJsxTexts(SCENE);
    expect(texts.map((t) => [t.key, t.value, t.layerId, t.form])).toEqual([
      ["t1", "Made with & love", "note-text", "text"],
      ["t2", "Literal words", "literal-text", "literal"],
    ]);
  });

  it("replaces it in place, as a braced string when it needs one", () => {
    expect(setJsxText(SCENE, "t1", "Made with care")).toContain('<p data-layer-id="note-text">Made with care</p>');
    expect(setJsxText(SCENE, "t1", "a {b} <c>")).toContain('<p data-layer-id="note-text">{"a {b} <c>"}</p>');
    expect(setJsxText(SCENE, "t2", "سلام")).toContain('{"سلام"}');
  });
});

describe("ensureSideEffectImport", () => {
  it("adds the import after the last one, once", () => {
    const once = ensureSideEffectImport(SCENE, "./fonts.css");
    expect(once).toContain('import { Stage, Sprite } from "./animations.jsx";\nimport "./fonts.css";\n');
    expect(ensureSideEffectImport(once, "./fonts.css")).toBe(once);
    expect(ensureSideEffectImport("const a = 1;", "./fonts.css")).toBe('import "./fonts.css";\nconst a = 1;');
  });
});

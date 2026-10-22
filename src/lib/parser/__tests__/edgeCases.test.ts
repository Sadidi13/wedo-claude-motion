/** Formatting / syntax edge cases: self-closing Stage, CRLF, tabs, member tags, TS type arguments. */
import { describe, expect, it } from "vitest";
import {
  deleteLayer,
  ensureLayerIds,
  insertLayer,
  listLayerIds,
  parseScene,
  setLayerTiming,
  wrapInSprite,
} from "../index";

const wrap = (stage: string) => `import React from "react";\nexport default function Scene() {\n  return (\n${stage}\n  );\n}\n`;

describe("edge cases", () => {
  it("opens a self-closing or empty Stage when inserting", () => {
    const selfClosing = wrap("    <Stage width={640} height={360} duration={4} fps={30} />");
    const { source, id } = insertLayer(selfClosing, null, "<p>hi</p>");
    expect(source).toContain(
      `    <Stage width={640} height={360} duration={4} fps={30}>\n      <p data-layer-id="${id}">hi</p>\n    </Stage>`,
    );
    expect(parseScene(source).layers.map((l) => l.id)).toEqual([id]);

    const empty = wrap("    <Stage width={640} height={360} duration={4} fps={30}>\n    </Stage>");
    const added = insertLayer(empty, null, "<p>hi</p>");
    expect(added.source).toContain(`fps={30}>\n      <p data-layer-id="${added.id}">hi</p>\n    </Stage>`);
  });

  it("keeps CRLF line endings and tab indentation", () => {
    const crlf = wrap(
      "\t\t<Stage width={640} height={360} duration={4} fps={30}>\n\t\t\t<Sprite start={0} end={1} data-layer-id=\"a\">\n\t\t\t\t<p data-layer-id=\"a-p\">A</p>\n\t\t\t</Sprite>\n\t\t</Stage>",
    ).replace(/\n/g, "\r\n");
    const inserted = insertLayer(crlf, null, "<div>\n  <b>x</b>\n</div>");
    // the snippet's own relative indentation (2 spaces) is kept below the file's tab indent
    expect(inserted.source).toContain(`\r\n\t\t\t<div data-layer-id="${inserted.id}">\r\n\t\t\t  <b data-layer-id=`);
    expect(inserted.source).toContain("</b>\r\n\t\t\t</div>\r\n\t\t</Stage>");
    expect(inserted.source).not.toMatch(/[^\r]\n/); // no bare LF introduced

    const wrapped = wrapInSprite(crlf, "a-p", 0, 1);
    expect(wrapped.source).toContain(`data-layer-name="A">\r\n\t\t\t\t\t<p data-layer-id="a-p">A</p>\r\n\t\t\t\t</Sprite>`);

    const removed = deleteLayer(crlf, "a");
    expect(removed).toContain("fps={30}>\r\n\t\t</Stage>");
    expect(parseScene(removed).layers).toEqual([]);
  });

  it("handles member-expression tags and TS type arguments", () => {
    const src = wrap(
      '    <Motion.Stage width={640} height={360} duration={4} fps={30}>\n      <Motion.Sprite start={1}>\n        <List<Item> items={[]} />\n      </Motion.Sprite>\n    </Motion.Stage>',
    );
    const { source } = ensureLayerIds(src);
    expect(source).toMatch(/<Motion\.Sprite data-layer-id="sprite-[a-z0-9]{6}" start=\{1\}>/);
    expect(source).toMatch(/<List<Item> data-layer-id="list-[a-z0-9]{6}" items=/);
    const scene = parseScene(source);
    expect(scene.layers[0].kind).toBe("sprite");
    expect(scene.layers[0].range).toEqual({ start: 1, end: 4 });
    expect(scene.layers[0].children[0].kind).toBe("component");
    const [spriteId] = listLayerIds(source);
    expect(setLayerTiming(source, spriteId, { end: 2 })).toContain("start={1} end={2}");
  });

  it("reads negative, Infinity and expression-container string props", () => {
    const src = wrap(
      '    <Stage width={640} height={360} duration={4} fps={30} background={"#123"}>\n      <Sprite start={-1} end={Infinity} data-layer-id="s" data-layer-name={`Named`} data-hidden />\n    </Stage>',
    );
    const scene = parseScene(src);
    expect(scene.meta.background).toBe("#123");
    expect(scene.byId.s.start).toBe(-1);
    expect(scene.byId.s.end).toBe(Infinity);
    expect(scene.byId.s.range).toEqual({ start: 0, end: 4 });
    expect(scene.byId.s.name).toBe("Named");
    expect(scene.byId.s.hidden).toBe(true);
    expect(scene.warnings).toEqual([]);
  });
});

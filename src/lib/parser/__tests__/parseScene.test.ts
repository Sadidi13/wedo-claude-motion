/** parseScene: meta, tree shape, naming, kinds, ranges, warnings, errors. */
import { describe, expect, it } from "vitest";
import { ParseError, getLayerSource, parseScene } from "../index";
import { FIXTURE, FIXTURE_IDS } from "./fixture";

const scene = parseScene(FIXTURE);

describe("parseScene", () => {
  it("reads the literal Stage props", () => {
    expect(scene.meta).toEqual({ width: 1280, height: 720, duration: 8, fps: 30, background: "#0b0b12" });
    expect(scene.stageLoc.line).toBe(13);
    expect(FIXTURE.slice(scene.stageLoc.start, scene.stageLoc.end)).toMatch(/^<Stage[\s\S]*<\/Stage>$/);
  });

  it("builds the tree in source order with byId covering every layer", () => {
    expect(scene.layers.map((l) => l.id)).toEqual(["bg", "title", "cards", "outro"]);
    expect(Object.keys(scene.byId).sort()).toEqual([...FIXTURE_IDS].sort());
    expect(scene.byId.row.parentId).toBe("cards");
    expect(scene.byId.cards.depth).toBe(0);
    expect(scene.byId.row.depth).toBe(1);
    expect(scene.byId.badge.depth).toBe(3);
    expect(scene.byId.cards.children.map((c) => c.id)).toEqual(["row"]);
    expect(scene.byId.row.children.map((c) => c.id)).toEqual(["card", "logo-sprite"]);
    expect(scene.byId.card.children.map((c) => c.id)).toEqual(["badge", "card-text"]);
  });

  it("treats elements inside function-children, conditionals and .map() as layers", () => {
    expect(scene.byId.title.children.map((c) => c.id)).toEqual(["title-h1"]);
    expect(scene.byId["title-h1"].parentId).toBe("title");
    expect(scene.byId["outro-note"].parentId).toBe("outro-box");
    expect(scene.byId.card.parentId).toBe("row");
    const repeated = scene.warnings.filter((w) => w.includes("repeated"));
    expect(repeated.some((w) => w.includes('"card"'))).toBe(true);
    expect(repeated.some((w) => w.includes('"badge"'))).toBe(true);
    expect(repeated.some((w) => w.includes('"logo"'))).toBe(false);
  });

  it("names layers: data-layer-name > own text (24 chars) > Sprite borrows its single child > <Tag>", () => {
    expect(scene.byId.bg.name).toBe("Background");
    expect(scene.byId.title.name).toBe("Title");
    expect(scene.byId["title-h1"].name).toBe("Hello");
    expect(scene.byId["outro-title"].name).toBe("Get started today with M");
    expect(scene.byId["outro-title"].textPreview).toBe("Get started today with Motion Studio");
    expect(scene.byId.outro.name).toBe("Get started today with M"); // borrowed via outro-box → h2
    expect(scene.byId.cards.name).toBe("<Sprite>");
    expect(scene.byId.row.name).toBe("<div>");
    expect(scene.byId["card-text"].name).toBe("<p>");
  });

  it("classifies kinds", () => {
    const kinds = Object.fromEntries(Object.values(scene.byId).map((l) => [l.id, l.kind]));
    expect(kinds).toEqual({
      bg: "sprite",
      "bg-fill": "shape",
      title: "sprite",
      "title-h1": "text",
      cards: "sprite",
      row: "group",
      card: "group",
      badge: "component",
      "card-text": "text",
      "logo-sprite": "sprite",
      logo: "image",
      outro: "sprite",
      "outro-box": "group",
      "outro-title": "text",
      "outro-note": "text",
    });
  });

  it("computes ranges: own timing ∩ ancestors, non-Sprites inherit, missing end clips to duration", () => {
    expect(scene.byId.bg.range).toEqual({ start: 0, end: 8 });
    expect(scene.byId.title.range).toEqual({ start: 0.5, end: 4 });
    expect(scene.byId["title-h1"].range).toEqual({ start: 0.5, end: 4 });
    expect(scene.byId["title-h1"].start).toBeUndefined();
    expect(scene.byId["logo-sprite"].start).toBe(3);
    expect(scene.byId["logo-sprite"].end).toBe(10);
    expect(scene.byId["logo-sprite"].range).toEqual({ start: 3, end: 6 });
    expect(scene.byId.logo.range).toEqual({ start: 3, end: 6 });
    expect(scene.byId.outro.end).toBe(Infinity);
    expect(scene.byId.outro.range).toEqual({ start: 6, end: 8 });
    expect(scene.byId["outro-note"].range).toEqual({ start: 6, end: 8 });
  });

  it("reports hidden / locked flags and loc matching getLayerSource", () => {
    const flagged = FIXTURE.replace(
      'data-layer-id="bg" data-layer-name="Background"',
      'data-layer-id="bg" data-layer-name="Background" data-hidden="true" data-locked',
    );
    const s = parseScene(flagged);
    expect(s.byId.bg.hidden).toBe(true);
    expect(s.byId.bg.locked).toBe(true);
    expect(s.byId.title.hidden).toBe(false);
    for (const id of FIXTURE_IDS) {
      const { loc } = scene.byId[id];
      expect(FIXTURE.slice(loc.start, loc.end)).toBe(getLayerSource(FIXTURE, id));
      expect(FIXTURE.slice(0, loc.start).split("\n").length).toBe(loc.line);
    }
  });

  it("warns about dynamic Sprite timing and makes it read-only", () => {
    const dyn = FIXTURE.replace("<Sprite start={2} end={6}", "<Sprite start={t > 1 ? 2 : 0} end={6}");
    const s = parseScene(dyn);
    expect(s.byId.cards.start).toBeUndefined();
    expect(s.byId.cards.end).toBe(6);
    expect(s.byId.cards.range).toEqual({ start: 0, end: 6 });
    expect(s.warnings.some((w) => w.includes('"cards"') && w.includes("dynamic"))).toBe(true);
  });

  it("tolerates missing ids with a warning and a synthetic id", () => {
    const s = parseScene(FIXTURE.replace(' data-layer-id="logo"', ""));
    const img = s.byId["logo-sprite"].children[0];
    expect(img.tag).toBe("img");
    expect(img.id).toMatch(/^img@\d+$/);
    expect(s.warnings.some((w) => w.includes("no data-layer-id"))).toBe(true);
  });

  it("throws ParseError with a line number on bad JSX", () => {
    const broken = FIXTURE.replace("</h1>", "</h2>");
    expect(() => parseScene(broken)).toThrow(ParseError);
    try {
      parseScene(broken);
    } catch (err) {
      const e = err as ParseError;
      expect(e.name).toBe("ParseError");
      expect(e.line).toBeGreaterThan(0);
      expect(typeof e.column).toBe("number");
      expect(e.message).toContain(`(${e.line}:${e.column})`);
    }
  });

  it("throws ParseError when there is no Stage or more than one", () => {
    expect(() => parseScene("export default function S() { return <div/>; }")).toThrow(/No <Stage>/);
    const two = FIXTURE.replace("<Sprite start={6} data-layer-id=\"outro\">", '<Stage data-layer-id="outro">').replace(
      /<\/Sprite>\n    <\/Stage>/,
      "</Stage>\n    </Stage>",
    );
    expect(() => parseScene(two)).toThrow(/exactly one <Stage>/);
  });
});

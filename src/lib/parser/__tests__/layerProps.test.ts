/** Per-layer attribute ops: timing, wrapInSprite, hidden / locked, name. */
import { describe, expect, it } from "vitest";
import {
  getLayerSource,
  parseScene,
  setLayerHidden,
  setLayerLocked,
  setLayerName,
  setLayerTiming,
  wrapInSprite,
} from "../index";
import { FIXTURE, expectCleanScene } from "./fixture";

describe("setLayerTiming", () => {
  it("rewrites start/end as short numeric literals and keeps the rest of the file", () => {
    const next = setLayerTiming(FIXTURE, "title", { start: 1.5, end: 4.0 });
    expect(next).toBe(FIXTURE.replace("<Sprite start={0.5} end={4}", "<Sprite start={1.5} end={4}"));
    const rounded = setLayerTiming(FIXTURE, "title", { start: 0.1 + 0.2, end: 1 / 3 });
    expect(rounded).toContain("<Sprite start={0.3} end={0.333}");
    const partial = setLayerTiming(FIXTURE, "title", { end: 7 });
    expect(partial).toContain("<Sprite start={0.5} end={7}");
  });

  it("adds missing attributes, keeping start before end", () => {
    const addEnd = setLayerTiming(FIXTURE, "outro", { end: 7.25 });
    expect(addEnd).toContain('<Sprite start={6} end={7.25} data-layer-id="outro">');
    const noTiming = FIXTURE.replace("<Sprite start={6} data-layer-id=\"outro\">", '<Sprite data-layer-id="outro">');
    expect(setLayerTiming(noTiming, "outro", { start: 1, end: 2 })).toContain('<Sprite start={1} end={2} data-layer-id="outro">');
    const onlyEnd = FIXTURE.replace("<Sprite start={6} data-layer-id=\"outro\">", '<Sprite end={8} data-layer-id="outro">');
    expect(setLayerTiming(onlyEnd, "outro", { start: 5 })).toContain('<Sprite start={5} end={8} data-layer-id="outro">');
    expect(parseScene(addEnd).byId.outro.range).toEqual({ start: 6, end: 7.25 });
  });

  it("throws for non-Sprite layers and NaN", () => {
    expect(() => setLayerTiming(FIXTURE, "row", { start: 1 })).toThrow("Layer row is not a Sprite; wrap it first");
    expect(() => setLayerTiming(FIXTURE, "title", { start: Number.NaN })).toThrow(/NaN/);
  });
});

describe("wrapInSprite", () => {
  it("wraps the element in a named Sprite, indented one level deeper", () => {
    const { source, spriteId } = wrapInSprite(FIXTURE, "outro-title", 6.5, 7.5);
    expect(spriteId).toMatch(/^sprite-[a-z0-9]{6}$/);
    expect(source).toContain(
      [
        `          <Sprite start={6.5} end={7.5} data-layer-id="${spriteId}" data-layer-name="Get started today with M">`,
        '            <h2 data-layer-id="outro-title">Get started today with Motion Studio</h2>',
        "          </Sprite>",
      ].join("\n"),
    );
    const scene = expectCleanScene(source);
    expect(scene.byId[spriteId].kind).toBe("sprite");
    expect(scene.byId[spriteId].parentId).toBe("outro-box");
    expect(scene.byId["outro-title"].parentId).toBe(spriteId);
    expect(scene.byId["outro-title"].range).toEqual({ start: 6.5, end: 7.5 });
  });

  it("handles multi-line elements and function-child bodies", () => {
    const { source, spriteId } = wrapInSprite(FIXTURE, "row", 2, 5);
    expect(source).toContain(`<Sprite start={2} end={5} data-layer-id="${spriteId}" data-layer-name="<div>">\n          <div data-layer-id="row" className="row">\n            {FEATURES.map`);
    expect(source).toContain("\n          </div>\n        </Sprite>\n      </Sprite>");
    expectCleanScene(source);
    const fn = wrapInSprite(FIXTURE, "title-h1", 1, 2);
    expect(parseScene(fn.source).byId["title-h1"].range).toEqual({ start: 1, end: 2 });
    expect(getLayerSource(fn.source, fn.spriteId)).toMatch(/^<Sprite start=\{1\} end=\{2\}[\s\S]*<\/Sprite>$/);
  });
});

describe("setLayerHidden / setLayerLocked", () => {
  it("adds the flag after data-layer-id, is idempotent and removes it cleanly", () => {
    const hidden = setLayerHidden(FIXTURE, "bg", true);
    expect(hidden).toContain('<Sprite start={0} end={8} data-layer-id="bg" data-hidden="true" data-layer-name="Background">');
    expect(setLayerHidden(hidden, "bg", true)).toBe(hidden);
    expect(parseScene(hidden).byId.bg.hidden).toBe(true);
    expect(setLayerHidden(hidden, "bg", false)).toBe(FIXTURE);
    expect(setLayerHidden(FIXTURE, "bg", false)).toBe(FIXTURE);

    const locked = setLayerLocked(FIXTURE, "card-text", true);
    expect(locked).toContain('<p data-layer-id="card-text" data-locked="true">{f}</p>');
    expect(parseScene(locked).byId["card-text"].locked).toBe(true);
    expect(setLayerLocked(locked, "card-text", false)).toBe(FIXTURE);
  });
});

describe("setLayerName", () => {
  it("sets, replaces, escapes and clears data-layer-name", () => {
    const named = setLayerName(FIXTURE, "cards", 'Feature "cards"');
    expect(named).toContain('<Sprite start={2} end={6} data-layer-id="cards" data-layer-name="Feature &quot;cards&quot;">');
    expect(parseScene(named).byId.cards.name).toBe('Feature "cards"');
    const renamed = setLayerName(FIXTURE, "bg", "Backdrop");
    expect(renamed).toBe(FIXTURE.replace('data-layer-name="Background"', 'data-layer-name="Backdrop"'));
    const cleared = setLayerName(FIXTURE, "bg", "  ");
    expect(cleared).toBe(FIXTURE.replace(' data-layer-name="Background"', ""));
    expect(parseScene(cleared).byId.bg.name).toBe("<Sprite>");
  });
});

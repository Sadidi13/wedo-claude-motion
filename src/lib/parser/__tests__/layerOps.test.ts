/** Structural ops: get / replace / delete / duplicate / insert / move / listLayerIds. */
import { describe, expect, it } from "vitest";
import {
  ParseError,
  deleteLayer,
  duplicateLayer,
  getLayerSource,
  insertLayer,
  listLayerIds,
  moveLayer,
  parseScene,
  replaceLayerSource,
} from "../index";
import { FIXTURE, FIXTURE_IDS, GENERATED_ID, expectCleanScene } from "./fixture";

describe("getLayerSource / listLayerIds", () => {
  it("returns the exact element text", () => {
    expect(getLayerSource(FIXTURE, "bg-fill")).toBe(
      '<div data-layer-id="bg-fill" style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg,#111,#223)" }} />',
    );
    expect(getLayerSource(FIXTURE, "title")).toMatch(/^<Sprite start=\{0\.5\}[\s\S]*<\/Sprite>$/);
    expect(getLayerSource(FIXTURE, "card-text")).toBe('<p data-layer-id="card-text">{f}</p>');
  });

  it("lists ids in source order and throws for unknown ids", () => {
    expect(listLayerIds(FIXTURE)).toEqual(FIXTURE_IDS);
    expect(() => getLayerSource(FIXTURE, "nope")).toThrow('Layer "nope" not found');
  });
});

describe("replaceLayerSource", () => {
  it("keeps the id (overriding the fragment's own) and leaves everything else byte-identical", () => {
    const original = getLayerSource(FIXTURE, "title-h1");
    const next = replaceLayerSource(FIXTURE, "title-h1", '<h1 data-layer-id="wrong" className="big">Hi there</h1>');
    const expected = FIXTURE.replace(original, '<h1 data-layer-id="title-h1" className="big">Hi there</h1>');
    expect(next).toBe(expected);
    expect(parseScene(next).byId["title-h1"].name).toBe("Hi there");
  });

  it("adds the id when the fragment has none", () => {
    const next = replaceLayerSource(FIXTURE, "bg-fill", '<div style={{ background: "red" }} />');
    expect(next).toContain('<div data-layer-id="bg-fill" style={{ background: "red" }} />');
    expect(listLayerIds(next)).toEqual(FIXTURE_IDS);
  });

  it("gives nested elements ids, keeps nested ids that are still unique, and re-indents", () => {
    const fragment = `<Sprite start={0} end={8} data-layer-name="Background">
  <div data-layer-id="bg-fill" className="fill" />
  <span>
    Hello
  </span>
</Sprite>`;
    const next = replaceLayerSource(FIXTURE, "bg", fragment);
    expect(next).toContain(
      [
        '      <Sprite data-layer-id="bg" start={0} end={8} data-layer-name="Background">',
        '        <div data-layer-id="bg-fill" className="fill" />',
        "        <span data-layer-id=\"span-",
      ].join("\n"),
    );
    expect(next).toContain("\n          Hello\n        </span>\n      </Sprite>");
    const scene = expectCleanScene(next);
    expect(scene.byId.bg.children.map((c) => c.id)).toEqual(["bg-fill", expect.stringMatching(/^span-/)]);
  });

  it("regenerates nested ids that collide with other layers", () => {
    const next = replaceLayerSource(FIXTURE, "bg", '<Sprite start={0} end={8}><div data-layer-id="row" /></Sprite>');
    const ids = listLayerIds(next);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === "row")).toHaveLength(1);
    expect(parseScene(next).byId.row.parentId).toBe("cards");
  });

  it("accepts a fragment wrapper, parentheses and a trailing semicolon", () => {
    for (const input of ["<>\n<p>A</p>\n</>", "(<p>A</p>)", "<p>A</p>;"]) {
      const next = replaceLayerSource(FIXTURE, "card-text", input);
      expect(next).toContain('<p data-layer-id="card-text">A</p>');
    }
  });

  it("rejects anything that is not exactly one element, with a ParseError", () => {
    expect(() => replaceLayerSource(FIXTURE, "card-text", "<p>A</p><p>B</p>")).toThrow(ParseError);
    expect(() => replaceLayerSource(FIXTURE, "card-text", "const x = 1;")).toThrow(/exactly one JSX element/);
    expect(() => replaceLayerSource(FIXTURE, "card-text", "")).toThrow(ParseError);
    try {
      replaceLayerSource(FIXTURE, "card-text", "<p>\n  <b>oops\n</p>");
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).line).toBe(3);
    }
  });
});

describe("deleteLayer", () => {
  it("removes a plain JSX child with its lines and nothing else", () => {
    const next = deleteLayer(FIXTURE, "bg");
    expect(next).not.toContain('data-layer-id="bg"');
    expect(next).toContain('background="#0b0b12">\n      <Sprite start={0.5}');
    expect(listLayerIds(next)).toEqual(FIXTURE_IDS.filter((id) => id !== "bg" && id !== "bg-fill"));
    expectCleanScene(next);
  });

  it("replaces an expression element (function-child body, .map item, && branch) with null", () => {
    const fn = deleteLayer(FIXTURE, "title-h1");
    expect(fn).toContain("{({ progress }) => (\n          null\n        )}");
    expectCleanScene(fn);
    const mapped = deleteLayer(FIXTURE, "card");
    expect(mapped).toContain("{FEATURES.map((f, i) => (\n            null\n          ))}");
    expectCleanScene(mapped);
    const cond = deleteLayer(FIXTURE, "outro-note");
    expect(cond).toContain("{t > 7 && null}");
    expectCleanScene(cond);
  });
});

describe("duplicateLayer", () => {
  it("inserts the copy after the original with fresh ids and a ' copy' name", () => {
    const { source, newId } = duplicateLayer(FIXTURE, "bg");
    expect(newId).toMatch(/^sprite-[a-z0-9]{6}$/);
    const ids = listLayerIds(source);
    expect(ids.slice(0, 4)).toEqual(["bg", "bg-fill", newId, expect.stringMatching(/^div-[a-z0-9]{6}$/)]);
    expect(source).toContain(
      `</Sprite>\n      <Sprite start={0} end={8} data-layer-id="${newId}" data-layer-name="Background copy">\n        <div data-layer-id="div-`,
    );
    const scene = expectCleanScene(source);
    expect(scene.byId[newId].name).toBe("Background copy");
    expect(scene.byId[newId].children[0].kind).toBe("shape");
  });

  it("uses the derived name when the original has no data-layer-name", () => {
    const { source, newId } = duplicateLayer(FIXTURE, "outro-title");
    expect(source).toContain(`<h2 data-layer-id="${newId}" data-layer-name="Get started today with M copy">`);
    expectCleanScene(source);
  });

  it("wraps a function-child body in a fragment so the arrow stays valid", () => {
    const { source, newId } = duplicateLayer(FIXTURE, "title-h1");
    expect(source).toMatch(/=> \(\n\s+<><h1 data-layer-id="title-h1"[\s\S]*<\/h1>\n\s+<h1 data-layer-id="h1-[a-z0-9]{6}"/);
    const scene = expectCleanScene(source);
    expect(scene.byId.title.children.map((c) => c.id)).toEqual(["title-h1", newId]);
    expect(scene.byId[newId].name).toBe("Hello copy");
  });
});

describe("insertLayer", () => {
  it("appends to the Stage with the Stage children's indentation", () => {
    const { source, id } = insertLayer(FIXTURE, null, '<Sprite start={1} end={2}>\n  <p>New</p>\n</Sprite>');
    expect(id).toMatch(/^sprite-[a-z0-9]{6}$/);
    expect(source).toContain(
      `      </Sprite>\n      <Sprite data-layer-id="${id}" start={1} end={2}>\n        <p data-layer-id="p-`,
    );
    expect(source).toContain("</p>\n      </Sprite>\n    </Stage>");
    const scene = expectCleanScene(source);
    expect(scene.layers.map((l) => l.id)).toEqual(["bg", "title", "cards", "outro", id]);
  });

  it("inserts at an index, into nested containers, keeping an unused fragment id", () => {
    const first = insertLayer(FIXTURE, null, '<div data-layer-id="intro" />', 0);
    expect(first.id).toBe("intro");
    expect(parseScene(first.source).layers[0].id).toBe("intro");
    expect(first.source).toContain('background="#0b0b12">\n      <div data-layer-id="intro" />\n      <Sprite start={0}');

    const nested = insertLayer(FIXTURE, "outro-box", "<small>fine print</small>", 1);
    expect(parseScene(nested.source).byId["outro-box"].children.map((c) => c.id)).toEqual([
      "outro-title",
      nested.id,
      "outro-note",
    ]);
    expect(nested.source).toContain(`</h2>\n          <small data-layer-id="${nested.id}">fine print</small>\n          {t > 7`);
  });

  it("regenerates a fragment id that is already used", () => {
    const { source, id } = insertLayer(FIXTURE, "row", '<div data-layer-id="card" />');
    expect(id).toMatch(GENERATED_ID);
    expectCleanScene(source);
  });

  it("opens a self-closing target and refuses function-children targets", () => {
    const { source, id } = insertLayer(FIXTURE, "bg-fill", "<span>inner</span>");
    expect(source).toContain(
      `background: "linear-gradient(135deg,#111,#223)" }}>\n          <span data-layer-id="${id}">inner</span>\n        </div>`,
    );
    expectCleanScene(source);
    expect(() => insertLayer(FIXTURE, "title", "<p>x</p>")).toThrow(/function-children/);
  });
});

describe("moveLayer", () => {
  it("swaps with the previous / next sibling and is a no-op at the edges", () => {
    const down = moveLayer(FIXTURE, "bg", { direction: "down" });
    expect(parseScene(down).layers.map((l) => l.id)).toEqual(["title", "bg", "cards", "outro"]);
    const up = moveLayer(down, "bg", { direction: "up" });
    expect(up).toBe(FIXTURE);
    expect(moveLayer(FIXTURE, "bg", { direction: "up" })).toBe(FIXTURE);
    expect(moveLayer(FIXTURE, "outro", { direction: "down" })).toBe(FIXTURE);
    const inner = moveLayer(FIXTURE, "badge", { direction: "down" });
    expect(parseScene(inner).byId.card.children.map((c) => c.id)).toEqual(["card-text", "badge"]);
    expect(inner).toContain('<p data-layer-id="card-text">{f}</p>\n              <Badge data-layer-id="badge" label={f} />');
  });

  it("re-parents into the Stage at an index and into another layer", () => {
    const toStage = moveLayer(FIXTURE, "logo-sprite", { parentId: null, index: 1 });
    const s1 = parseScene(toStage);
    expect(s1.layers.map((l) => l.id)).toEqual(["bg", "logo-sprite", "title", "cards", "outro"]);
    expect(s1.byId["logo-sprite"].range).toEqual({ start: 3, end: 8 });
    expect(toStage).toContain('      </Sprite>\n      <Sprite start={3} end={10} data-layer-id="logo-sprite">\n        <img data-layer-id="logo"');

    const intoOutro = moveLayer(FIXTURE, "bg-fill", { parentId: "outro-box", index: 0 });
    const s2 = parseScene(intoOutro);
    expect(s2.byId["outro-box"].children.map((c) => c.id)).toEqual(["bg-fill", "outro-title", "outro-note"]);
    expect(s2.byId.bg.children).toEqual([]);
    expectCleanScene(intoOutro);
  });

  it("refuses moving into itself or into a function-children parent", () => {
    expect(() => moveLayer(FIXTURE, "cards", { parentId: "row", index: 0 })).toThrow(/into itself/);
    expect(() => moveLayer(FIXTURE, "bg", { parentId: "title", index: 0 })).toThrow(/function-children/);
  });
});

describe("round trip", () => {
  it("delete + duplicate + move keep the scene parseable with unique ids", () => {
    let src = deleteLayer(FIXTURE, "title");
    const dup = duplicateLayer(src, "cards");
    src = dup.source;
    src = moveLayer(src, dup.newId, { direction: "up" });
    src = moveLayer(src, "outro-title", { parentId: null, index: 0 });
    src = deleteLayer(src, "card");
    const scene = expectCleanScene(src);
    expect(scene.layers.map((l) => l.id)).toEqual(["outro-title", "bg", dup.newId, "cards", "outro"]);
    expect(scene.byId[dup.newId].name).toBe("<Sprite> copy");
  });
});

/** ensureLayerIds: ids added once, stable, unique, only inside the Stage subtree. */
import { describe, expect, it } from "vitest";
import { ensureLayerIds, listLayerIds, parseScene } from "../index";
import { FIXTURE, FIXTURE_IDS, FIXTURE_NO_IDS, GENERATED_ID } from "./fixture";

describe("ensureLayerIds", () => {
  it("adds a data-layer-id to every element inside <Stage>, right after the tag name", () => {
    const { source, changed } = ensureLayerIds(FIXTURE_NO_IDS);
    expect(changed).toBe(true);
    const ids = listLayerIds(source);
    expect(ids).toHaveLength(FIXTURE_IDS.length);
    for (const id of ids) expect(id).toMatch(GENERATED_ID);
    expect(source).toMatch(/<Sprite data-layer-id="sprite-[a-z0-9]{6}" start=\{0\} end=\{8\}/);
    expect(source).toMatch(/<h1 data-layer-id="h1-[a-z0-9]{6}" style=/);
    expect(source).toMatch(/<Badge data-layer-id="badge-[a-z0-9]{6}" label=\{f\}/);
    expect(source).toMatch(/<img data-layer-id="img-[a-z0-9]{6}" src=/);
  });

  it("is idempotent: a second call changes nothing and keeps every id", () => {
    const first = ensureLayerIds(FIXTURE_NO_IDS);
    const second = ensureLayerIds(first.source);
    expect(second.changed).toBe(false);
    expect(second.source).toBe(first.source);
    expect(listLayerIds(second.source)).toEqual(listLayerIds(first.source));
  });

  it("leaves a fully-annotated file byte-identical", () => {
    const { source, changed } = ensureLayerIds(FIXTURE);
    expect(changed).toBe(false);
    expect(source).toBe(FIXTURE);
  });

  it("never touches JSX outside the Stage subtree (helper components) or the Stage itself", () => {
    const { source } = ensureLayerIds(FIXTURE_NO_IDS);
    expect(source).toContain('return <span className="badge">{label}</span>;');
    expect(source).toMatch(/<Stage width=\{1280\}/);
  });

  it("does not treat JSX inside attributes as a layer", () => {
    const src = `import React from "react";
export default function Scene() {
  return (
    <Stage width={100} height={100} duration={2} fps={30}>
      <Card icon={<Zap size={16} />}>
        <span>Fast</span>
      </Card>
    </Stage>
  );
}`;
    const { source } = ensureLayerIds(src);
    expect(source).toContain("icon={<Zap size={16} />}");
    expect(listLayerIds(source)).toHaveLength(2);
    const scene = parseScene(source);
    expect(scene.layers[0].tag).toBe("Card");
    expect(scene.layers[0].children.map((c) => c.tag)).toEqual(["span"]);
  });

  it("keeps existing ids and regenerates only duplicates", () => {
    const dup = FIXTURE.replace('data-layer-id="outro-box"', 'data-layer-id="row"');
    const { source, changed } = ensureLayerIds(dup);
    expect(changed).toBe(true);
    const ids = listLayerIds(source);
    expect(new Set(ids).size).toBe(ids.length);
    // the first "row" wins, the later duplicate gets a fresh div id
    expect(ids[FIXTURE_IDS.indexOf("row")]).toBe("row");
    expect(ids[FIXTURE_IDS.indexOf("outro-box")]).toMatch(/^div-[a-z0-9]{6}$/);
    expect(ids.filter((id) => id !== ids[FIXTURE_IDS.indexOf("outro-box")])).toEqual(
      FIXTURE_IDS.filter((id) => id !== "outro-box"),
    );
  });

  it("only edits the missing attributes and keeps the rest byte-identical", () => {
    const partial = FIXTURE.replace(' data-layer-id="logo"', "");
    const { source } = ensureLayerIds(partial);
    const stripped = source.replace(/ data-layer-id="img-[a-z0-9]{6}"/, "");
    expect(stripped).toBe(partial);
  });
});

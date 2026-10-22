import { describe, expect, it } from "vitest";
import { parseScene } from "@/lib/parser";
import { ancestorIds, dragBoundsFor, flattenLayers, hasLiteralTiming, sourceDirectionFor } from "../layerRows";
import { SCENE } from "./fixture";

const scene = parseScene(SCENE);

describe("flattenLayers", () => {
  it("lists the last child first (top of the canvas = top of the panel) and nests children after their parent", () => {
    const rows = flattenLayers(scene.layers, {});
    expect(rows.map((r) => r.node.id)).toEqual([
      "dyn", "dyn-text", "cards", "row", "card-b", "card-a", "title", "title-h1", "bg", "bg-fill",
    ]);
    expect(rows.find((r) => r.node.id === "cards")?.hasChildren).toBe(true);
    expect(rows.find((r) => r.node.id === "card-a")?.depth).toBe(2);
  });

  it("hides the subtree of collapsed rows", () => {
    const rows = flattenLayers(scene.layers, { cards: true, title: true });
    expect(rows.map((r) => r.node.id)).toEqual(["dyn", "dyn-text", "cards", "title", "bg", "bg-fill"]);
    expect(rows.find((r) => r.node.id === "cards")?.collapsed).toBe(true);
  });
});

describe("helpers", () => {
  it("maps panel directions to source directions", () => {
    expect(sourceDirectionFor("up")).toBe("down");
    expect(sourceDirectionFor("down")).toBe("up");
  });

  it("detects literal timing", () => {
    expect(hasLiteralTiming(scene.byId.title)).toBe(true);
    expect(hasLiteralTiming(scene.byId.dyn)).toBe(false);
    expect(hasLiteralTiming(scene.byId.row)).toBe(false);
  });

  it("walks ancestors and computes drag bounds from the parent range", () => {
    expect(ancestorIds(scene.byId, "card-a")).toEqual(["row", "cards"]);
    expect(ancestorIds(scene.byId, "bg")).toEqual([]);
    expect(dragBoundsFor(scene.byId, scene.byId.title, 8)).toEqual({ start: 0, end: 8 });
    expect(dragBoundsFor(scene.byId, scene.byId.row, 8)).toEqual({ start: 2, end: 6 });
  });
});

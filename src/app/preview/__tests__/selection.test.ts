import { describe, expect, it } from "vitest";
import { findLayerIdInPath } from "../selection";

function el(attrs: Record<string, string> = {}) {
  return { getAttribute: (name: string) => attrs[name] ?? null };
}

describe("findLayerIdInPath", () => {
  const stage = el();

  it("returns the deepest data-layer-id before the stage", () => {
    const path = [el(), el({ "data-layer-id": "h1-abc" }), el({ "data-layer-id": "sprite-xyz" }), stage, el(), {}];
    expect(findLayerIdInPath(path, stage)).toBe("h1-abc");
  });

  it("returns null for empty stage area", () => {
    expect(findLayerIdInPath([stage, el({ "data-layer-id": "outside" })], stage)).toBeNull();
    expect(findLayerIdInPath([el(), el()], stage)).toBeNull();
  });

  it("skips non-element nodes (text, window, document)", () => {
    const path = [{ nodeType: 3 }, el({ "data-layer-id": "p-1" }), stage];
    expect(findLayerIdInPath(path, stage)).toBe("p-1");
  });
});

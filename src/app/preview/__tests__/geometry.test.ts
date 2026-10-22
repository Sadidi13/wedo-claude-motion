import { describe, expect, it } from "vitest";
import { toOverlayBox } from "../geometry";

describe("toOverlayBox", () => {
  it("is a plain offset at scale 1 (embed mode)", () => {
    const box = toOverlayBox({ id: "a", x: 10, y: 20, width: 100, height: 50 }, { left: 0, top: 0, width: 1280 }, { left: 0, top: 0, width: 1280 }, 1280);
    expect(box).toEqual({ left: 10, top: 20, width: 100, height: 50 });
  });

  it("applies the stage's on-screen scale and offset (standalone mode)", () => {
    const box = toOverlayBox(
      { id: "a", x: 100, y: 100, width: 200, height: 100 },
      { left: 116, top: 16, width: 640 },
      { left: 100, top: 0, width: 800 },
      1280,
    );
    expect(box).toEqual({ left: 16 + 50, top: 16 + 50, width: 100, height: 50 });
  });

  it("falls back to scale 1 when sizes are unknown", () => {
    const box = toOverlayBox({ id: "a", x: 5, y: 5, width: 1, height: 1 }, { left: 0, top: 0, width: 0 }, { left: 0, top: 0, width: 0 }, 0);
    expect(box).toEqual({ left: 5, top: 5, width: 1, height: 1 });
  });
});

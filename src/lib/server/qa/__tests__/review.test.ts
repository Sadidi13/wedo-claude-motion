/** The visual review's contact sheets: which samples they show and how they are laid out. */
import { describe, expect, it } from "vitest";
import { reviewLayout } from "../index";

describe("reviewLayout", () => {
  it("shows twelve evenly spread samples, the first and the last included", () => {
    const { picks } = reviewLayout(1080, 1920, 40);
    expect(picks).toHaveLength(12);
    expect(picks[0]).toBe(0);
    expect(picks[11]).toBe(39);
    expect(new Set(picks).size).toBe(12);
    for (let i = 1; i < picks.length; i++) expect(picks[i] - picks[i - 1]).toBeGreaterThanOrEqual(3);
  });

  it("shows every sample of a short video", () => {
    expect(reviewLayout(1080, 1080, 6).picks).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("puts six frames on a sheet Claude reads without shrinking it", () => {
    const tall = reviewLayout(1080, 1920, 40);
    expect([tall.columns, tall.rows]).toEqual([3, 2]);
    expect(Math.max(tall.columns * tall.tileWidth, tall.rows * tall.tileHeight)).toBeLessThanOrEqual(1569);
    expect(tall.tileWidth / tall.tileHeight).toBeCloseTo(1080 / 1920, 2);

    const wide = reviewLayout(1920, 1080, 40);
    expect([wide.columns, wide.rows]).toEqual([2, 3]);
    expect(Math.max(wide.columns * wide.tileWidth, wide.rows * wide.tileHeight)).toBeLessThanOrEqual(1569);
  });
});

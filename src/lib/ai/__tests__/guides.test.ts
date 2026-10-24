/** The contract sections that list catalogues: built-in sounds and the style library stay in step with the code. */
import { describe, expect, it } from "vitest";
import { SFX, SFX_NAMES } from "@/lib/audio/sfx";
import { SYSTEM_PROMPT } from "../prompts";
import { STORYBOARD_GUIDE } from "../storyboard";
import { STYLE_LIBRARY, styleLibraryMarkdown } from "../styleLibrary";

describe("sound section", () => {
  const section = SYSTEM_PROMPT.slice(SYSTEM_PROMPT.indexOf("# 5. Sound"), SYSTEM_PROMPT.indexOf("# 6. Export"));

  it("names every built-in sound, and only those", () => {
    for (const name of SFX_NAMES) expect(section).toContain(name);
    const listed = section.match(/Names: ([^.]+)\./)![1].replace("and the looping beds", "").split(/,\s*/).map((name) => name.trim()).filter(Boolean);
    expect(listed.sort()).toEqual([...SFX_NAMES].sort());
  });

  it("calls the looping ones beds", () => {
    const beds = SFX_NAMES.filter((name) => SFX[name].loop);
    expect(beds.sort()).toEqual(["beat-120", "beat-90", "pad"]);
    for (const name of beds) expect(section).toMatch(new RegExp(`looping beds[^.]*${name}`));
  });
});

describe("style library", () => {
  it("has unique names with concrete recipes", () => {
    const names = STYLE_LIBRARY.map((style) => style.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThanOrEqual(100);
    for (const style of STYLE_LIBRARY) expect(style.recipe.length).toBeGreaterThan(40);
  });

  it("is listed by name in the storyboard guide and with recipes in the markdown", () => {
    const markdown = styleLibraryMarkdown();
    for (const { name, recipe } of STYLE_LIBRARY) {
      expect(STORYBOARD_GUIDE).toContain(name);
      expect(markdown).toContain(`- **${name}**: ${recipe}.`);
    }
  });
});

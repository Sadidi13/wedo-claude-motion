/** The contract sections that list catalogues: the sound bank and the style library stay in step with the code. */
import { describe, expect, it } from "vitest";
import { realMusicMarkdown, realSoundsMarkdown } from "@/lib/audio/realSounds";
import { SFX_NAMES } from "@/lib/audio/sfx";
import { SYSTEM_PROMPT } from "../prompts";
import { STORYBOARD_GUIDE } from "../storyboard";
import { STYLE_LIBRARY, styleLibraryMarkdown } from "../styleLibrary";

describe("sound section", () => {
  const section = SYSTEM_PROMPT.slice(SYSTEM_PROMPT.indexOf("# 5. Sound"), SYSTEM_PROMPT.indexOf("# 6. Export"));

  it("lists every real effect with its hit time and every music bed with its beat", () => {
    expect(section).toContain(realSoundsMarkdown());
    expect(section).toContain(realMusicMarkdown());
  });

  it("no longer offers the synthesized sounds for new scenes", () => {
    for (const name of SFX_NAMES) expect(section).not.toContain(`sfx="${name}"`);
    expect(section).toContain("the old synthesized `sfx` sounds are kept only so older scenes still play");
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

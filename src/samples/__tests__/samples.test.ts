/** Bundled samples must be contract-clean: ≥ 5 named top-level Sprites, zero parse warnings, stable ids. */
import { describe, expect, it } from "vitest";
import { findDisallowedImports, findForbiddenCalls } from "@/lib/ai/validate";
import { ensureLayerIds, listLayerIds, parseScene } from "@/lib/parser";
import { samples } from "../index";

const ALLOWED_IMPORTS = /^(react|react-dom(\/client)?|lucide-react|three|gsap(\/\w+)?|\.\/animations\.jsx|\.\/[\w./-]+)$/;

describe("samples", () => {
  it("ships product-launch, lower-third, dolly-3d and kinetic-type with the contract meta", () => {
    expect(samples.map((s) => s.id)).toEqual(["product-launch", "lower-third", "dolly-3d", "kinetic-type"]);
    expect(samples[3].project.meta).toEqual({ width: 1080, height: 1920, duration: 5, fps: 30, background: "#0b0b12" });
    expect(samples[0].project.meta).toEqual({ width: 1280, height: 720, duration: 8, fps: 30, background: "#0b0b12" });
    expect(samples[1].project.meta).toEqual({ width: 1920, height: 1080, duration: 5, fps: 30, background: "#101418" });
    expect(samples[2].project.meta).toEqual({ width: 1080, height: 1920, duration: 6, fps: 30, background: "#07080d" });
  });

  it("dolly-3d draws its world in one Three3D canvas layer and the text as 2D layers", () => {
    const source = samples[2].project.files["scene.jsx"].content;
    const scene = parseScene(source);
    expect(source).toContain('import * as THREE from "three";');
    expect(scene.layers.map((l) => l.name)).toEqual(["3D world", "Vignette", "Kicker", "Title", "Subtitle"]);
    expect(scene.byId.world.children.map((c) => [c.id, c.kind])).toEqual([["corridor", "canvas"]]);
    expect(source).not.toMatch(/performance\.now|setAnimationLoop|\+=/);
  });

  it("kinetic-type animates with useGsapTimeline only, and passes the AI validator's rules", () => {
    const source = samples[3].project.files["scene.jsx"].content;
    expect(source).toContain('import { SplitText } from "gsap/SplitText";');
    expect((source.match(/useGsapTimeline\(/g) ?? []).length).toBe(4);
    expect(source).not.toMatch(/gsap\.(to|from|fromTo|timeline)\(/);
    expect(findDisallowedImports(source)).toEqual([]);
    expect(findForbiddenCalls(source)).toEqual([]);
    expect(parseScene(source).layers.map((l) => l.name)).toEqual(["Background", "Kicker", "Headline", "Underline", "Subtitle"]);
  });

  it.each(samples.map((s) => [s.id, s] as const))("%s parses with ≥ 5 named top-level Sprites and no warnings", (_id, sample) => {
    const { project } = sample;
    expect(project).toMatchObject({ id: `sample-${sample.id}`, entry: "scene.jsx", origin: "sample" });
    const source = project.files[project.entry].content;
    const scene = parseScene(source);
    expect(scene.warnings).toEqual([]);
    expect(scene.layers.length).toBeGreaterThanOrEqual(5);
    for (const layer of scene.layers) {
      expect(layer.kind).toBe("sprite");
      expect(layer.name).not.toMatch(/^</);
      expect(typeof layer.start).toBe("number");
      expect(typeof layer.end).toBe("number");
      expect(layer.end).toBeLessThanOrEqual(scene.meta.duration);
    }
    const ids = listLayerIds(source);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ensureLayerIds(source).changed).toBe(false);
    for (const m of source.matchAll(/from "([^"]+)"/g)) expect(m[1]).toMatch(ALLOWED_IMPORTS);
    expect(source).not.toMatch(/Math\.random|Date\.now|setTimeout|requestAnimationFrame|@keyframes|transition:/);
  });

  it("product-launch has the staggered cards, the chart bars and lucide icons", () => {
    const source = samples[0].project.files["scene.jsx"].content;
    const scene = parseScene(source);
    expect(source).toContain('import { Zap, Shield, Sparkles } from "lucide-react";');
    const cards = scene.layers.filter((l) => l.name.startsWith("Card"));
    expect(cards.map((c) => c.start)).toEqual([3, 3.12, 3.24]);
    expect(scene.layers.find((l) => l.name === "Growth chart")?.children[0].id).toBe("div-chart");
    expect(scene.byId["div-chart-plot"].children.filter((c) => c.tag === "Bar")).toHaveLength(4);
    expect(scene.layers.map((l) => l.name)).toEqual([
      "Background", "Title", "Subtitle", "Card · Instant", "Card · Reliable", "Card · Beautiful", "Growth chart", "Logo", "Call to action",
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { insertLayer, parseScene } from "@/lib/parser";
import {
  assetPathFor,
  clipAtPlayhead,
  ensureSpriteImport,
  imageLayerTemplate,
  shapeLayerTemplate,
  textLayerTemplate,
} from "../templates";
import { SCENE } from "./fixture";

describe("clipAtPlayhead", () => {
  it("starts at the playhead and pulls back to fit the stage", () => {
    expect(clipAtPlayhead(3, 8, 30)).toEqual({ start: 3, end: 5 });
    expect(clipAtPlayhead(7.5, 8, 30)).toEqual({ start: 6, end: 8 });
    expect(clipAtPlayhead(-2, 8, 30)).toEqual({ start: 0, end: 2 });
    expect(clipAtPlayhead(0, 1, 30)).toEqual({ start: 0, end: 1 });
  });
});

describe("templates parse and insert as Sprites", () => {
  const timing = { start: 1, end: 3 };
  const stage = { width: 1280, height: 720 };

  it.each([
    ["text", textLayerTemplate(timing, stage), "Text", "sprite"],
    ["rect", shapeLayerTemplate(timing, "rect", stage), "Rectangle", "sprite"],
    ["circle", shapeLayerTemplate(timing, "circle", stage), "Circle", "sprite"],
    ["image", imageLayerTemplate(timing, "assets/logo.png", 'logo "v2".png'), 'logo "v2".png', "sprite"],
  ])("%s template", (_label, jsx, name, kind) => {
    const { source, id } = insertLayer(SCENE, null, jsx);
    const scene = parseScene(source);
    const node = scene.byId[id];
    expect(node.kind).toBe(kind);
    expect(node.name).toBe(name);
    expect(node.start).toBe(1);
    expect(node.end).toBe(3);
    expect(scene.layers[scene.layers.length - 1].id).toBe(id);
  });

  it("image template references the asset path and the child is an image layer", () => {
    const { source, id } = insertLayer(SCENE, null, imageLayerTemplate(timing, "assets/logo.png", "logo.png"));
    const node = parseScene(source).byId[id];
    expect(node.children[0].kind).toBe("image");
    expect(source).toContain('src="assets/logo.png"');
  });
});

describe("assetPathFor", () => {
  it("sanitises names and avoids collisions", () => {
    expect(assetPathFor("My Logo (final).PNG", [])).toBe("assets/my-logo-final.png");
    expect(assetPathFor("logo.png", ["assets/logo.png"])).toBe("assets/logo-2.png");
    expect(assetPathFor("logo.png", ["assets/logo.png", "assets/logo-2.png"])).toBe("assets/logo-3.png");
    expect(assetPathFor("???", [])).toBe("assets/image");
  });
});

describe("ensureSpriteImport", () => {
  it("leaves a file that already imports Sprite alone", () => {
    expect(ensureSpriteImport(SCENE)).toBe(SCENE);
  });

  it("extends the runtime import's named list", () => {
    const without = SCENE.replace("{ Stage, Sprite, Easing }", "{ Stage, Easing }");
    const out = ensureSpriteImport(without);
    expect(out).toContain('import { Stage, Easing, Sprite } from "./animations.jsx";');
    expect(out.replace(/import \{[^}]*\} from "\.\/animations\.jsx";/, "")).toBe(
      without.replace(/import \{[^}]*\} from "\.\/animations\.jsx";/, ""),
    );
  });

  it("adds a new import after the last import when there is no runtime import", () => {
    const only = `import React from "react";\n\nexport default function S() { return <Stage />; }\n`;
    expect(ensureSpriteImport(only)).toBe(
      `import React from "react";\nimport { Sprite } from "./animations.jsx";\n\nexport default function S() { return <Stage />; }\n`,
    );
    expect(ensureSpriteImport("const x = 1;")).toMatch(/^import \{ Sprite \} from "\.\/animations\.jsx";\n/);
  });

  it("does nothing when Sprite is declared locally", () => {
    const local = `const Sprite = (p) => <div {...p} />;\nexport default () => <Stage><Sprite /></Stage>;`;
    expect(ensureSpriteImport(local)).toBe(local);
  });
});

import { describe, expect, it } from "vitest";
import type { ProjectFile } from "@/lib/types";
import { assetReferenceVariants, collectAssets, rewriteAssetReferences, rewriteCssAssetReferences } from "../assets";

const LOGO = "data:image/png;base64,iVBORw0KGgo=";
const BG = "data:image/jpeg;base64,/9j/4AAQ";

const files: Record<string, ProjectFile> = {
  "scene.jsx": { path: "scene.jsx", kind: "jsx", content: "" },
  "assets/logo.png": { path: "assets/logo.png", kind: "asset", content: LOGO },
  "assets/bg.jpg": { path: "./assets/bg.jpg", kind: "asset", content: BG },
};
const assets = collectAssets(files);

describe("collectAssets", () => {
  it("lists asset files with normalised paths", () => {
    expect(assets).toEqual([
      { path: "assets/logo.png", dataUrl: LOGO },
      { path: "assets/bg.jpg", dataUrl: BG },
    ]);
  });
});

describe("assetReferenceVariants", () => {
  it("includes bare, ./, / and file-relative spellings", () => {
    expect(assetReferenceVariants("assets/logo.png", "scene.jsx").sort()).toEqual(
      ["./assets/logo.png", "/assets/logo.png", "assets/logo.png"].sort(),
    );
    expect(assetReferenceVariants("assets/logo.png", "components/Card.jsx")).toContain("../assets/logo.png");
  });
});

describe("rewriteAssetReferences (JS/JSX)", () => {
  it("replaces quoted asset paths in JSX attributes, expressions and imports", () => {
    const src = [
      `import logo from "./assets/logo.png";`,
      `const bg = 'assets/bg.jpg';`,
      "const tpl = `/assets/logo.png`;",
      `<img src="assets/logo.png" />`,
    ].join("\n");
    const out = rewriteAssetReferences(src, "scene.jsx", assets);
    expect(out).toContain(`import logo from "${LOGO}";`);
    expect(out).toContain(`const bg = '${BG}';`);
    expect(out).toContain("const tpl = `" + LOGO + "`;");
    expect(out).toContain(`<img src="${LOGO}" />`);
    expect(out).not.toContain("assets/logo.png");
  });

  it("understands paths relative to a nested file", () => {
    const out = rewriteAssetReferences(`<img src="../assets/logo.png" />`, "components/Card.jsx", assets);
    expect(out).toBe(`<img src="${LOGO}" />`);
  });

  it("leaves non-matching and partial strings alone", () => {
    const src = `const a = "assets/logo.png.bak"; const b = "other/logo.png"; const c = \`assets/\${name}.png\`;`;
    expect(rewriteAssetReferences(src, "scene.jsx", assets)).toBe(src);
  });
});

describe("rewriteCssAssetReferences", () => {
  it("rewrites url() in every quoting style", () => {
    const css = `.a{background:url(assets/bg.jpg)} .b{background:url("./assets/bg.jpg")} .c{background:url( '/assets/logo.png' )}`;
    const out = rewriteCssAssetReferences(css, "styles.css", assets);
    expect(out).toBe(`.a{background:url("${BG}")} .b{background:url("${BG}")} .c{background:url("${LOGO}")}`);
  });

  it("resolves relative to the css file's directory", () => {
    const out = rewriteCssAssetReferences(`.a{background:url(../assets/bg.jpg)}`, "styles/main.css", assets);
    expect(out).toBe(`.a{background:url("${BG}")}`);
  });
});

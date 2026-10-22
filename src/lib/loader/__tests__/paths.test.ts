import { describe, expect, it } from "vitest";
import { candidatePaths, dirname, extensionOf, isRelativeSpecifier, normalisePath, relativeSpecifier, resolveRelative } from "../paths";

describe("normalisePath", () => {
  it("strips ./ and leading slashes and resolves ..", () => {
    expect(normalisePath("./scene.jsx")).toBe("scene.jsx");
    expect(normalisePath("/assets/logo.png")).toBe("assets/logo.png");
    expect(normalisePath("a/b/../c//d.jsx")).toBe("a/c/d.jsx");
    expect(normalisePath("..\\x\\y.js")).toBe("x/y.js");
  });
});

describe("dirname / extensionOf", () => {
  it("returns '' for root files", () => {
    expect(dirname("scene.jsx")).toBe("");
    expect(dirname("components/Card.jsx")).toBe("components");
  });
  it("lower-cases the extension and ignores dot-files", () => {
    expect(extensionOf("assets/Logo.PNG")).toBe(".png");
    expect(extensionOf(".env")).toBe("");
    expect(extensionOf("README")).toBe("");
  });
});

describe("isRelativeSpecifier / resolveRelative", () => {
  it("recognises ./ ../ and root-absolute specifiers", () => {
    expect(isRelativeSpecifier("./a")).toBe(true);
    expect(isRelativeSpecifier("../a")).toBe(true);
    expect(isRelativeSpecifier("/a")).toBe(true);
    expect(isRelativeSpecifier("react")).toBe(false);
    expect(isRelativeSpecifier("@motion/runtime")).toBe(false);
  });
  it("resolves against the importing file's directory", () => {
    expect(resolveRelative("scene.jsx", "./Card.jsx")).toBe("Card.jsx");
    expect(resolveRelative("components/Card.jsx", "../styles.css")).toBe("styles.css");
    expect(resolveRelative("components/Card.jsx", "./Icon")).toBe("components/Icon");
    expect(resolveRelative("components/Card.jsx", "/assets/a.png")).toBe("assets/a.png");
  });
});

describe("candidatePaths", () => {
  it("probes the path, source extensions, then index files", () => {
    expect(candidatePaths("components/Card")).toEqual([
      "components/Card",
      "components/Card.jsx",
      "components/Card.js",
      "components/Card.tsx",
      "components/Card.ts",
      "components/Card/index.jsx",
      "components/Card/index.js",
      "components/Card/index.tsx",
      "components/Card/index.ts",
    ]);
  });
});

describe("relativeSpecifier", () => {
  it("builds the ./ or ../ form that reaches the target", () => {
    expect(relativeSpecifier("scene.jsx", "assets/logo.png")).toBe("./assets/logo.png");
    expect(relativeSpecifier("components/Card.jsx", "assets/logo.png")).toBe("../assets/logo.png");
    expect(relativeSpecifier("components/Card.jsx", "components/icon.svg")).toBe("./icon.svg");
    expect(relativeSpecifier("a/b/c.jsx", "a/x.png")).toBe("../x.png");
  });
});

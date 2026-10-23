import { describe, expect, it } from "vitest";
import type { ProjectFile } from "@/lib/types";
import { LoadError } from "../errors";
import { buildFileTable, resolveSpecifier } from "../resolve";

const files: Record<string, ProjectFile> = buildFileTable({
  "./scene.jsx": { path: "./scene.jsx", kind: "jsx", content: "" },
  "components/Card.jsx": { path: "components/Card.jsx", kind: "jsx", content: "" },
  "components/Icon/index.tsx": { path: "components/Icon/index.tsx", kind: "tsx", content: "" },
  "styles.css": { path: "styles.css", kind: "css", content: "" },
  "assets/logo.png": { path: "assets/logo.png", kind: "asset", content: "data:image/png;base64,AA==" },
  "animations.jsx": { path: "animations.jsx", kind: "jsx", content: "// project's own copy" },
});

describe("buildFileTable", () => {
  it("keys files by normalised path", () => {
    expect(Object.keys(files)).toContain("scene.jsx");
    expect(Object.keys(files)).not.toContain("./scene.jsx");
  });
});

describe("resolveSpecifier: builtins and aliases", () => {
  it("maps react / react-dom / lucide-react", () => {
    expect(resolveSpecifier("scene.jsx", "react", files)).toEqual({ kind: "builtin", name: "react" });
    expect(resolveSpecifier("scene.jsx", "react-dom", files)).toEqual({ kind: "builtin", name: "react-dom" });
    expect(resolveSpecifier("scene.jsx", "react-dom/client", files)).toEqual({ kind: "builtin", name: "react-dom" });
    expect(resolveSpecifier("scene.jsx", "lucide-react", files)).toEqual({ kind: "builtin", name: "lucide-react" });
  });

  it("maps three, but not three.js addons (only the main module is provided)", () => {
    expect(resolveSpecifier("scene.jsx", "three", files)).toEqual({ kind: "builtin", name: "three" });
    for (const addon of ["three/addons/controls/OrbitControls.js", "three/examples/jsm/postprocessing/EffectComposer.js"]) {
      expect(() => resolveSpecifier("scene.jsx", addon, files)).toThrowError(`Unsupported import '${addon}' in file scene.jsx`);
    }
  });

  it("maps every runtime alias to the runtime, even when the project ships its own animations.jsx", () => {
    for (const spec of ["./animations.jsx", "./animations", "./animations.js", "@motion/runtime", "motion-runtime"]) {
      expect(resolveSpecifier("scene.jsx", spec, files)).toEqual({ kind: "builtin", name: "runtime" });
    }
    expect(resolveSpecifier("components/Card.jsx", "../animations.jsx", files)).toEqual({ kind: "builtin", name: "runtime" });
  });

  it("passes data: URLs through (asset imports after rewriting)", () => {
    expect(resolveSpecifier("scene.jsx", "data:image/png;base64,AA==", files)).toEqual({
      kind: "data",
      url: "data:image/png;base64,AA==",
    });
  });
});

describe("resolveSpecifier: project files", () => {
  it("resolves exact relative paths", () => {
    expect(resolveSpecifier("scene.jsx", "./styles.css", files)).toMatchObject({ kind: "file", path: "styles.css" });
    expect(resolveSpecifier("scene.jsx", "./assets/logo.png", files)).toMatchObject({ kind: "file", path: "assets/logo.png" });
  });

  it("probes source extensions and index files", () => {
    expect(resolveSpecifier("scene.jsx", "./components/Card", files)).toMatchObject({ kind: "file", path: "components/Card.jsx" });
    expect(resolveSpecifier("scene.jsx", "./components/Icon", files)).toMatchObject({
      kind: "file",
      path: "components/Icon/index.tsx",
    });
    expect(resolveSpecifier("components/Card.jsx", "./Icon", files)).toMatchObject({ kind: "file", path: "components/Icon/index.tsx" });
    expect(resolveSpecifier("components/Card.jsx", "../styles.css", files)).toMatchObject({ kind: "file", path: "styles.css" });
  });

  it("throws LoadError naming specifier and file for unsupported bare imports", () => {
    let caught: unknown;
    try {
      resolveSpecifier("components/Card.jsx", "framer-motion", files);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LoadError);
    const err = caught as LoadError;
    expect(err.message).toBe("Unsupported import 'framer-motion' in file components/Card.jsx");
    expect(err.file).toBe("components/Card.jsx");
  });

  it("throws LoadError for missing relative files", () => {
    expect(() => resolveSpecifier("scene.jsx", "./Missing.jsx", files)).toThrowError(
      /Cannot find module '\.\/Missing\.jsx' imported from scene\.jsx/,
    );
  });
});

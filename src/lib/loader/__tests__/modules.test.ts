import { describe, expect, it, vi } from "vitest";
import { GSAP_MODULES, type GsapModule } from "@/lib/gsapModules";
import type { ProjectFile } from "@/lib/types";
import { LoadError } from "../errors";
import { createModuleSystem, type ModuleSystemOptions } from "../modules";
import { buildFileTable } from "../resolve";
import { asEsModule, createReactDomShim } from "../shims";

/** Minimal React stand-in: createElement returns a plain description. */
const fakeReact = {
  createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
};

const runtime = { Stage: "Stage", Sprite: "Sprite", useTime: () => 0 };

/** `gsap` and each plugin subpath, exporting `{ <Name>: "<Name>" }` with that as the default too. */
const gsapStandIns = Object.fromEntries(
  GSAP_MODULES.map((name) => {
    const exportName = name === "gsap" ? "gsap" : name.slice("gsap/".length);
    return [name, asEsModule({ [exportName]: exportName }, exportName)];
  }),
) as Record<GsapModule, unknown>;

function system(files: Record<string, ProjectFile>, overrides: Partial<ModuleSystemOptions> = {}) {
  const injectCss = vi.fn();
  const sys = createModuleSystem({
    files: buildFileTable(files),
    react: fakeReact,
    injectCss,
    builtins: {
      react: asEsModule(fakeReact),
      "react-dom": createReactDomShim(() => {}),
      "lucide-react": asEsModule({ Star: "Star" }),
      three: asEsModule({ Mesh: "Mesh", REVISION: "186" }),
      ...gsapStandIns,
      runtime: asEsModule(runtime),
    },
    ...overrides,
  });
  return { sys, injectCss };
}

const file = (path: string, content: string, kind: ProjectFile["kind"] = "jsx"): ProjectFile => ({ path, kind, content });

describe("createModuleSystem", () => {
  it("evaluates the entry and exposes its default export", () => {
    const { sys } = system({
      "scene.jsx": file(
        "scene.jsx",
        `import React from "react";
import { Stage } from "./animations.jsx";
export default function Scene() { return <Stage width={10} />; }`,
      ),
    });
    const exports = sys.load("scene.jsx") as { default: () => unknown };
    expect(typeof exports.default).toBe("function");
    expect(exports.default()).toEqual({ type: "Stage", props: { width: 10 }, children: [] });
  });

  it("resolves relative imports, caches modules and injects css once", () => {
    const { sys, injectCss } = system({
      "scene.jsx": file(
        "scene.jsx",
        `import { Card } from "./components/Card";
import "./styles.css";
import "./components/Card";
export default () => Card("x");`,
      ),
      "components/Card.jsx": file(
        "components/Card.jsx",
        `import "../styles.css";
export let created = 0;
export const Card = (t) => { created++; return <b>{t}</b>; };`,
      ),
      "styles.css": file("styles.css", ".a{background:url(assets/bg.png)}", "css"),
      "assets/bg.png": file("assets/bg.png", "data:image/png;base64,AA==", "asset"),
    });
    const exports = sys.load("scene.jsx") as { default: () => unknown };
    expect(exports.default()).toEqual({ type: "b", props: null, children: ["x"] });
    expect(injectCss).toHaveBeenCalledTimes(1);
    expect(injectCss).toHaveBeenCalledWith("styles.css", `.a{background:url("data:image/png;base64,AA==")}`);
  });

  it("returns data URLs for asset imports and parsed values for json", () => {
    const { sys } = system({
      "scene.jsx": file(
        "scene.jsx",
        `import logo from "./assets/logo.png";
import data from "./data.json";
export const src = logo;
export const n = data.n;
export default () => <img src="assets/logo.png" />;`,
      ),
      "assets/logo.png": file("assets/logo.png", "data:image/png;base64,QUJD", "asset"),
      "data.json": file("data.json", `{"n": 42}`, "json"),
    });
    const exports = sys.load("scene.jsx") as { src: string; n: number; default: () => { props: { src: string } } };
    expect(exports.src).toBe("data:image/png;base64,QUJD");
    expect(exports.n).toBe(42);
    expect(exports.default().props.src).toBe("data:image/png;base64,QUJD");
  });

  it("hands out builtins for react-dom / lucide-react / runtime aliases", () => {
    const { sys } = system({
      "scene.jsx": file(
        "scene.jsx",
        `import ReactDOM from "react-dom/client";
import { Star } from "lucide-react";
import * as rt from "@motion/runtime";
export const all = [typeof ReactDOM.createRoot, Star, rt.Sprite];`,
      ),
    });
    expect((sys.load("scene.jsx") as { all: unknown[] }).all).toEqual(["function", "Star", "Sprite"]);
  });

  it("hands out three for namespace, named and default imports", () => {
    const { sys } = system({
      "scene.jsx": file(
        "scene.jsx",
        `import * as THREE from "three";
import { Mesh } from "three";
import three from "three";
export const all = [THREE.REVISION, Mesh, three.Mesh];`,
      ),
    });
    expect((sys.load("scene.jsx") as { all: unknown[] }).all).toEqual(["186", "Mesh", "Mesh"]);
  });

  it("hands out gsap and its supported plugins, default and named, .js spelling included", () => {
    const { sys } = system({
      "scene.jsx": file(
        "scene.jsx",
        `import gsapDefault, { gsap } from "gsap";
import { SplitText } from "gsap/SplitText";
import DrawSVG from "gsap/DrawSVGPlugin.js";
export const all = [gsapDefault, gsap, SplitText, DrawSVG];`,
      ),
    });
    expect((sys.load("scene.jsx") as { all: unknown[] }).all).toEqual(["gsap", "gsap", "SplitText", "DrawSVGPlugin"]);
  });

  it("throws LoadError for unsupported imports, naming the importing file", () => {
    const { sys } = system({
      "scene.jsx": file("scene.jsx", `import { Comp } from "./components/Comp";\nexport default Comp;`),
      "components/Comp.jsx": file("components/Comp.jsx", `import { motion } from "framer-motion";\nexport const Comp = motion;`),
    });
    let caught: unknown;
    try {
      sys.load("scene.jsx");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LoadError);
    expect((caught as LoadError).message).toBe("Unsupported import 'framer-motion' in file components/Comp.jsx");
    expect((caught as LoadError).file).toBe("components/Comp.jsx");
  });

  it("detects import cycles", () => {
    const { sys } = system({
      "a.js": file("a.js", `import "./b.js"; export const a = 1;`, "js"),
      "b.js": file("b.js", `import "./a.js"; export const b = 2;`, "js"),
    });
    expect(() => sys.load("a.js")).toThrowError(/Circular import: a\.js -> b\.js -> a\.js/);
  });

  it("wraps evaluation errors and reports the entry file when missing", () => {
    const { sys } = system({ "scene.jsx": file("scene.jsx", `throw new Error("boom");`) });
    expect(() => sys.load("scene.jsx")).toThrowError(/Error evaluating scene\.jsx: boom/);
    expect(() => sys.load("nope.jsx")).toThrowError(/Entry file 'nope\.jsx' not found/);
  });
});

/** Import merging, render-call detection and Stage wrapping on small sources. */
import { describe, expect, it } from "vitest";
import { parseScene } from "@/lib/parser";
import { analyseModule } from "../ast";
import { assembleScene } from "../assemble";
import { mergeImports, normaliseImportSource, renderImports } from "../imports";
import { DEFAULT_IMPORT_META } from "../meta";

function analyse(source: string) {
  const result = analyseModule(source);
  if (!result.ok) throw new Error(result.error);
  return result.analysis;
}

describe("analyseModule", () => {
  it("finds imports, components, the default export, render calls and the Stage", () => {
    const a = analyse(`import React, { useState } from "react";
import * as L from "lucide-react";
const Card = () => <div />;
function Scene() { return <Stage width={1} />; }
export default Scene;
const root = ReactDOM.createRoot(el);
root.render(<Scene />);
`);
    expect(a.imports.map((i) => [i.source, i.defaultName, i.namespace, i.named.map((n) => n.local)])).toEqual([
      ["react", "React", undefined, ["useState"]],
      ["lucide-react", undefined, "L", []],
    ]);
    expect([...a.declared].sort()).toEqual(["Card", "L", "React", "Scene", "root", "useState"]);
    expect(a.components.map((c) => c.name)).toEqual(["Card", "Scene"]);
    expect(a.defaultExport).toMatchObject({ name: "Scene", isDeclaration: false });
    expect(a.renderCall).not.toBeNull();
    expect(a.stageStart).toBeGreaterThan(0);
  });

  it("recognises the classic ReactDOM.render(el, container) form and ignores unrelated .render calls", () => {
    expect(analyse(`ReactDOM.render(<App />, document.body);`).renderCall).not.toBeNull();
    expect(analyse(`createRoot(el).render(App());`).renderCall).not.toBeNull();
    expect(analyse(`renderer.render(scene, camera);`).renderCall).toBeNull();
    expect(analyse(`export default function () {}`).defaultExport).toMatchObject({ name: undefined, isDeclaration: true });
  });

  it("reports syntax errors instead of throwing", () => {
    expect(analyseModule("const = ;")).toMatchObject({ ok: false });
  });
});

describe("mergeImports", () => {
  it("normalises CDN urls and runtime aliases", () => {
    expect(normaliseImportSource("https://esm.sh/react@18.2.0")).toEqual({ source: "react", supported: true });
    expect(normaliseImportSource("https://esm.sh/react-dom@18.2.0/client")).toEqual({ source: "react-dom/client", supported: true });
    expect(normaliseImportSource("https://esm.sh/lucide-react@0.4?deps=react")).toEqual({ source: "lucide-react", supported: true });
    expect(normaliseImportSource("animations.jsx")).toEqual({ source: "./animations.jsx", supported: true });
    expect(normaliseImportSource("@motion/runtime")).toEqual({ source: "./animations.jsx", supported: true });
    expect(normaliseImportSource("./Card.jsx")).toEqual({ source: "./Card.jsx", supported: true });
    expect(normaliseImportSource("framer-motion")).toEqual({ source: "framer-motion", supported: false });
    expect(normaliseImportSource("https://esm.sh/animejs")).toEqual({ source: "https://esm.sh/animejs", supported: false });
  });

  it("provides gsap and its supported plugins (bare, .js and from CDNs) but no other plugins", () => {
    expect(normaliseImportSource("gsap")).toEqual({ source: "gsap", supported: true });
    expect(normaliseImportSource("gsap/SplitText.js")).toEqual({ source: "gsap/SplitText", supported: true });
    for (const url of ["https://esm.sh/gsap@3.15.0", "https://cdn.jsdelivr.net/npm/gsap@3.13.0/+esm", "https://unpkg.com/gsap@3/index.js"]) {
      expect(normaliseImportSource(url)).toEqual({ source: "gsap", supported: true });
    }
    expect(normaliseImportSource("https://esm.sh/gsap@3.15.0/SplitText")).toEqual({ source: "gsap/SplitText", supported: true });
    expect(normaliseImportSource("https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/DrawSVGPlugin.min.js")).toEqual({
      source: "gsap/DrawSVGPlugin",
      supported: true,
    });
    expect(normaliseImportSource("gsap/ScrollTrigger")).toMatchObject({ supported: false });
    expect(normaliseImportSource("https://esm.sh/gsap@3/ScrambleTextPlugin")).toMatchObject({ supported: false });
  });

  it("provides three.js (bare and from CDNs) but not its addons", () => {
    expect(normaliseImportSource("three")).toEqual({ source: "three", supported: true });
    for (const url of [
      "https://esm.sh/three",
      "https://esm.sh/three@0.186.1",
      "https://unpkg.com/three@0.160.0/build/three.module.js",
      "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js",
      "https://cdn.jsdelivr.net/npm/three@0.170.0/+esm",
    ]) {
      expect(normaliseImportSource(url)).toEqual({ source: "three", supported: true });
    }
    expect(normaliseImportSource("three/addons/controls/OrbitControls.js")).toMatchObject({ supported: false });
    expect(normaliseImportSource("https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js")).toMatchObject({
      supported: false,
    });
  });

  it("merges duplicate modules, drops re-bound locals and leaves clean files untouched", () => {
    const a = analyse(`import React from "react";
import React2, { useState } from "react";
import { Stage } from "./animations.jsx";
import { Stage as S, Sprite } from "animations.jsx";
import type { X } from "./types";
`);
    const merged = mergeImports(a.imports);
    expect(merged.changed).toBe(true);
    expect(merged.unsupported).toEqual([]);
    expect(renderImports(merged.imports)).toBe(
      ['import React, { useState } from "react";', 'import { Stage, Stage as S, Sprite } from "./animations.jsx";'].join("\n"),
    );

    const clean = mergeImports(analyse(`import React from "react";\nimport { Stage } from "./animations.jsx";\n`).imports);
    expect(clean.changed).toBe(false);
  });
});

describe("assembleScene", () => {
  const meta = { ...DEFAULT_IMPORT_META, background: "#123" };

  it("keeps a well-formed scene byte-for-byte", () => {
    const code = `import React from "react";\nimport { Stage, Sprite } from "./animations.jsx";\n\nexport default function Scene() {\n  return <Stage width={10} height={10} duration={1} fps={1} />;\n}\n`;
    const out = assembleScene({ code, cssImports: [], fallbackMeta: meta });
    expect(out.source).toBe(code);
    expect(out.warnings).toEqual([]);
    expect(out.wrapped).toBe(false);
  });

  it("appends an export for a Stage-rendering component and imports the runtime it uses as globals", () => {
    const out = assembleScene({ code: `function Main() { return <Stage width={2} height={2} duration={1} fps={1}><Sprite /></Stage>; }`, cssImports: ["./styles.css"], fallbackMeta: meta });
    expect(out.source).toBe(
      [
        'import "./styles.css";',
        'import React from "react";',
        'import { Stage, Sprite } from "./animations.jsx";',
        "",
        "function Main() { return <Stage width={2} height={2} duration={1} fps={1}><Sprite /></Stage>; }",
        "",
        "export default Main;",
        "",
      ].join("\n"),
    );
  });

  it("wraps the element passed to render() in a Stage built from the fallback meta", () => {
    const out = assembleScene({
      code: `import React from "react";\nfunction App() { return <p>x</p>; }\nReactDOM.createRoot(root).render(<App />);`,
      cssImports: [],
      fallbackMeta: meta,
    });
    expect(out.wrapped).toBe(true);
    expect(out.source).toContain(
      'render(<Stage width={1920} height={1080} duration={10} fps={30} background="#123"><App /></Stage>);',
    );
    expect(out.source).toContain('import ReactDOM from "react-dom/client";');
    expect(out.source).toContain('import { Stage } from "./animations.jsx";');
    expect(out.source.match(/from "react";/g)).toHaveLength(1);
    expect(out.warnings).toEqual([expect.stringContaining("wrapped")]);
    expect(parseScene(out.source).layers.map((l) => l.tag)).toEqual(["App"]);
  });

  it("detaches an anonymous default export and renders it inside a generated root", () => {
    const out = assembleScene({ code: `export default () => <div>hi</div>;`, cssImports: [], fallbackMeta: meta });
    expect(out.source).toContain("const MotionStudioRootInner = () => <div>hi</div>;");
    expect(out.source).toContain("<MotionStudioRootInner />");
    expect(out.source).toContain("export default function MotionStudioRoot()");
    expect(parseScene(out.source).layers.map((l) => l.tag)).toEqual(["MotionStudioRootInner"]);
  });

  it("warns and leaves unparseable code alone", () => {
    const out = assembleScene({ code: "const = ;", cssImports: ["./a.css"], fallbackMeta: meta });
    expect(out.source).toBe('import "./a.css";\nconst = ;\n');
    expect(out.warnings[0]).toMatch(/could not be parsed/);
  });

  it("imports three.js and Three3D for code that uses them as globals (CDN script pages)", () => {
    const out = assembleScene({
      code: [
        "function Scene() {",
        "  return (",
        "    <Stage width={2} height={2} duration={1} fps={1}>",
        "      <Three3D setup={({ scene }) => scene.add(new THREE.AmbientLight())} />",
        "    </Stage>",
        "  );",
        "}",
      ].join("\n"),
      cssImports: [],
      fallbackMeta: meta,
    });
    expect(out.source.split("\n").slice(0, 3)).toEqual([
      'import React from "react";',
      'import * as THREE from "three";',
      'import { Stage, Three3D } from "./animations.jsx";',
    ]);
    expect(out.warnings).toEqual([]);
    expect(parseScene(out.source).layers.map((l) => l.kind)).toEqual(["canvas"]);
  });

  it("imports the gsap globals of CDN script pages and warns when GSAP runs outside useGsapTimeline", () => {
    const stage = "<Stage width={2} height={2} duration={1} fps={1}><Sprite><Title /></Sprite></Stage>";
    const driven = assembleScene({
      code: [
        "function Title() {",
        '  const ref = useGsapTimeline((tl) => { const s = SplitText.create("h1", { type: "chars" }); tl.from(s.chars, { y: 20, stagger: 0.05 }); });',
        "  return <div ref={ref}><h1>Hi</h1></div>;",
        "}",
        `function Scene() { return ${stage}; }`,
      ].join("\n"),
      cssImports: [],
      fallbackMeta: meta,
    });
    expect(driven.source.split("\n").slice(0, 3)).toEqual([
      'import React from "react";',
      'import { SplitText } from "gsap/SplitText";',
      'import { Stage, Sprite, useGsapTimeline } from "./animations.jsx";',
    ]);
    expect(driven.warnings).toEqual([]);

    const playing = assembleScene({
      code: `function Title() { gsap.to("h1", { y: 20 }); return <h1>Hi</h1>; }\nfunction Scene() { return ${stage}; }`,
      cssImports: [],
      fallbackMeta: meta,
    });
    expect(playing.source).toContain('import { gsap } from "gsap";');
    expect(playing.warnings).toEqual([expect.stringContaining("uses GSAP outside useGsapTimeline")]);
  });

  it("keeps a module scene's own three import and warns about three.js addons", () => {
    const code = [
      'import React from "react";',
      'import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";',
      'import { OrbitControls } from "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js";',
      'import { Stage } from "./animations.jsx";',
      "export default function Scene() { return <Stage width={2} height={2} duration={1} fps={1} />; }",
    ].join("\n");
    const out = assembleScene({ code, cssImports: [], fallbackMeta: meta });
    expect(out.source).toContain('import * as THREE from "three";');
    expect(out.source.match(/from "three"/g)).toHaveLength(1);
    expect(out.warnings).toEqual([
      expect.stringContaining('Import "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js" cannot be loaded'),
    ]);
    expect(out.warnings[0]).toContain("only react, react-dom, lucide-react, three, gsap and its supported plugins, the runtime");
  });

  it("warns about scenes that ship their own Stage implementation", () => {
    const out = assembleScene({
      code: `function Stage({ children }) { return <div>{children}</div>; }\nexport default function Scene() { return <Stage width={1} height={1} duration={1} fps={1} />; }`,
      cssImports: [],
      fallbackMeta: meta,
    });
    expect(out.warnings).toEqual([expect.stringContaining("defines its own Stage")]);
    expect(out.source).not.toContain("animations.jsx");
  });
});

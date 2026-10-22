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
    expect(normaliseImportSource("three")).toEqual({ source: "three", supported: false });
    expect(normaliseImportSource("https://esm.sh/three")).toEqual({ source: "https://esm.sh/three", supported: false });
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

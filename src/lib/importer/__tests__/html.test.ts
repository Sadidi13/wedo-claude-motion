/** importFromHtml end to end: babel page, no-Stage page, static page, script src handling. */
import { describe, expect, it } from "vitest";
import { parseScene } from "@/lib/parser";
import type { ProjectFile } from "@/lib/types";
import { importFromHtml, importFromHtmlDetailed } from "../html";
import { BABEL_PAGE, NO_STAGE_PAGE, STATIC_PAGE } from "./fixtures";

describe("importFromHtml", () => {
  it("turns a text/babel page into scene.jsx + styles.css + fonts.css with meta from the Stage", () => {
    const { project, warnings } = importFromHtmlDetailed(BABEL_PAGE);
    expect(project.entry).toBe("scene.jsx");
    expect(project.name).toBe("Nova & friends");
    expect(project.origin).toBe("html");
    expect(project.meta).toEqual({ width: 1280, height: 720, duration: 6, fps: 24, background: "#000" });

    expect(Object.keys(project.files).sort()).toEqual(["fonts.css", "scene.jsx", "styles.css"]);
    expect(project.files["styles.css"]).toMatchObject({ kind: "css" });
    expect(project.files["styles.css"].content).toContain(".title { color: red; }");
    expect(project.files["fonts.css"].content).toBe(
      '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap");\n',
    );

    const scene = project.files["scene.jsx"].content;
    expect(scene.startsWith('import "./styles.css";\nimport "./fonts.css";\nimport ReactDOM from "react-dom/client";\n')).toBe(true);
    expect(scene).toContain('import React from "react";');
    expect(scene).toContain('import { Stage, Sprite } from "./animations.jsx";');
    expect(scene).toContain("render(<Scene />)");
    expect(scene).not.toContain("alert(");

    const parsed = parseScene(scene);
    expect(parsed.layers).toHaveLength(1);
    expect(parsed.layers[0].kind).toBe("sprite");
    expect(parsed.layers[0].children[0].name).toBe("Hi");
    expect(parsed.warnings).toEqual([]);

    expect(warnings).toEqual([expect.stringContaining("cdn.tailwindcss.com")]);
  });

  it("wraps a page without <Stage> around its render call using window.__videoMeta, with a warning", () => {
    const { project, warnings } = importFromHtmlDetailed(NO_STAGE_PAGE, { name: "Vertical" });
    expect(project.name).toBe("Vertical");
    expect(project.meta).toEqual({ width: 1080, height: 1920, duration: 12, fps: 60 });
    const scene = project.files["scene.jsx"].content;
    expect(scene).toContain('import React from "react";');
    expect(scene).toContain('import ReactDOM from "react-dom/client";');
    expect(scene).toContain('import { Stage } from "./animations.jsx";');
    // ensureLayerIds stamps the layers inside the Stage, never the Stage itself
    expect(scene).toMatch(/render\(<Stage width=\{1080\} height=\{1920\} duration=\{12\} fps=\{60\}><App data-layer-id="[a-z0-9-]+" \/><\/Stage>\)/);
    expect(warnings).toEqual([expect.stringMatching(/No <Stage> found; the rendered root was wrapped/)]);
    expect(parseScene(scene).layers.map((l) => l.kind)).toEqual(["component"]);
  });

  it("wraps static HTML (no React at all) into a single raw-markup layer and reads hz:canvas hints", () => {
    const { project, warnings } = importFromHtmlDetailed(STATIC_PAGE);
    expect(project.origin).toBe("html");
    expect(project.meta).toEqual({ width: 800, height: 600, duration: 10, fps: 30 });
    const scene = project.files["scene.jsx"].content;
    expect(scene).toContain('import "./styles.css";');
    expect(scene).toContain("dangerouslySetInnerHTML={{ __html: STATIC_MARKUP }}");
    expect(scene).toContain('const STATIC_MARKUP = "<div class=\\"card\\"><h1>Static title</h1><p>Body \\"quoted\\"</p></div>";');
    const parsed = parseScene(scene);
    expect(parsed.layers).toHaveLength(1);
    expect(parsed.layers[0]).toMatchObject({ kind: "sprite", name: "HTML markup", start: 0, end: 10 });
    expect(parsed.layers[0].children).toHaveLength(1);
    expect(warnings).toEqual([
      expect.stringContaining("plain JavaScript without React"),
      expect.stringContaining("static HTML was placed in one Stage layer"),
    ]);
  });

  it("creates a root for a component page with neither Stage nor render call", () => {
    const { project } = importFromHtmlDetailed(`<script type="text/jsx">function Animation() { return <div>x</div>; }</script>`);
    const scene = project.files["scene.jsx"].content;
    expect(scene).toContain("export default function MotionStudioRoot()");
    expect(scene).toContain("<Animation");
    expect(project.meta).toEqual({ width: 1920, height: 1080, duration: 10, fps: 30 });
  });

  it("inlines relative <script src> files from the archive, drops the runtime file and warns about missing ones", () => {
    const files: Record<string, ProjectFile> = {
      "scene.jsx": {
        path: "scene.jsx",
        kind: "jsx",
        content: `import { Stage } from "./animations.jsx";\nfunction Scene() { return <Stage width={4} height={3} duration={2} fps={10} />; }`,
      },
      "animations.jsx": { path: "animations.jsx", kind: "jsx", content: "export const Stage = () => null;" },
      "styles.css": { path: "styles.css", kind: "css", content: "body{}" },
    };
    const html = `<link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="missing.css">
<script src="animations.jsx"></script><script src="scene.jsx"></script><script src="vendor/three.js"></script>`;
    const { project, warnings } = importFromHtmlDetailed(html, { files });
    expect(Object.keys(project.files).sort()).toEqual(["animations.jsx", "scene.jsx", "styles.css"]);
    expect(project.meta).toEqual({ width: 4, height: 3, duration: 2, fps: 10 });
    expect(project.files["scene.jsx"].content).toContain('import "./styles.css";');
    expect(project.files["scene.jsx"].content).toContain("export default Scene;");
    expect(warnings).toEqual([
      expect.stringContaining('"vendor/three.js"'),
      expect.stringContaining('"missing.css"'),
    ]);
  });

  it("merges duplicate imports from several script blocks and rewrites CDN imports", () => {
    const html = `<script type="text/babel" data-type="module">
import React from "https://esm.sh/react@18.2.0";
import { createRoot } from "https://esm.sh/react-dom@18.2.0/client";
import { Stage } from "./animations.jsx";
</script>
<script type="text/babel" data-type="module">
import React, { useMemo } from "react";
import { Sprite } from "./animations.jsx";
function Scene() { return <Stage width={1} height={1} duration={1} fps={1}><Sprite /></Stage>; }
createRoot(document.body).render(<Scene />);
</script>`;
    const { project, warnings } = importFromHtmlDetailed(html);
    const scene = project.files["scene.jsx"].content;
    expect(scene.split("\n").slice(0, 3)).toEqual([
      'import React, { useMemo } from "react";',
      'import { createRoot } from "react-dom/client";',
      'import { Stage, Sprite } from "./animations.jsx";',
    ]);
    expect(scene).not.toContain("esm.sh");
    expect(warnings).toEqual([]);
  });

  it("returns an empty Stage with a warning for an empty page and exposes the plain variant", () => {
    const { project, warnings } = importFromHtmlDetailed("<html><body></body></html>");
    expect(warnings).toEqual([expect.stringContaining("empty Stage")]);
    expect(parseScene(project.files["scene.jsx"].content).layers).toEqual([]);
    expect(importFromHtml(BABEL_PAGE).name).toBe("Nova & friends");
  });
});

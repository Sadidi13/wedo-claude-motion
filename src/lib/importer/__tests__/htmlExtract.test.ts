/** The DOM-free tokenizer: scripts, styles, comments, links, metas, body, hints. */
import { describe, expect, it } from "vitest";
import { extractHtml, hasStaticMarkup, parseAttributes } from "../htmlExtract";
import { BABEL_PAGE, STATIC_PAGE } from "./fixtures";

describe("extractHtml", () => {
  it("parses attributes in every quoting style and decodes entities", () => {
    expect(parseAttributes(` type="text/babel" data-type='module' async src=app.js title="a &amp; b"`)).toEqual({
      type: "text/babel",
      "data-type": "module",
      async: "",
      src: "app.js",
      title: "a & b",
    });
  });

  it("collects scripts in order, skipping commented-out ones, and keeps `>` inside script bodies", () => {
    const page = extractHtml(BABEL_PAGE);
    expect(page.scripts.map((s) => s.attrs.src ?? s.attrs.type)).toEqual([
      "https://unpkg.com/react@18/umd/react.development.js",
      "https://unpkg.com/react-dom@18/umd/react-dom.development.js",
      "https://unpkg.com/@babel/standalone/babel.min.js",
      "https://cdn.tailwindcss.com",
      "importmap",
      "text/babel",
    ]);
    const scene = page.scripts[5];
    expect(scene.attrs["data-type"]).toBe("module");
    expect(scene.body).toContain("render(<Scene />)");
    expect(scene.body).toContain("<Stage width={1280}");
    expect(page.styles).toHaveLength(1);
    expect(page.styles[0]).toContain(".title { color: red; }");
    expect(page.title).toBe("Nova & friends");
    expect(page.links.map((l) => l.href)).toEqual([
      "https://fonts.googleapis.com",
      "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap",
    ]);
  });

  it("extracts the body without scripts/styles and reads hz:canvas hints", () => {
    const page = extractHtml(STATIC_PAGE);
    expect(page.body).toBe('<div class="card"><h1>Static title</h1><p>Body "quoted"</p></div>');
    expect(page.metas.map((m) => m.name)).toEqual(["hz:canvas-width", "hz:canvas-height"]);
    expect(hasStaticMarkup(page.body)).toBe(true);
    expect(extractHtml(BABEL_PAGE).body).toBe('<div id="root"></div>');
    expect(hasStaticMarkup('<div id="root"></div>\n<main id="app"><div></div></main>')).toBe(false);
    expect(extractHtml('<div data-canvas-width="640" data-canvas-height=480></div>').canvas).toEqual({ width: 640, height: 480 });
  });

  it("tolerates an unterminated script and documents without <body>", () => {
    const page = extractHtml("<p>text</p><script>let x = 1;");
    expect(page.scripts[0].body).toBe("let x = 1;");
    expect(page.body).toBe("<p>text</p>");
  });
});

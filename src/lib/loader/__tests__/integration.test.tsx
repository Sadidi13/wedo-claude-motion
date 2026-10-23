/**
 * End-to-end check of the module system with the REAL React and the real
 * runtime module (what loadProject wires up in the browser), rendered with
 * react-dom/server: a contract-style scene compiles, resolves its imports,
 * and produces the expected stage markup. Covers the sucrase interop path
 * (`import React from "react"`, named runtime imports, side-effect css import)
 * and the 3D path (`import * as THREE from "three"` + <Three3D> as one layer).
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { GsapModule } from "@/lib/gsapModules";
import type { ProjectFile } from "@/lib/types";
import * as runtime from "@/runtime";
import { resetClock, setClock } from "@/runtime/clock";
import { GSAP_NAMESPACES } from "@/runtime/gsap";
import { createModuleSystem } from "../modules";
import { buildFileTable } from "../resolve";
import { asEsModule, createReactDomShim } from "../shims";

const SCENE = `
import React from "react";
import { Stage, Sprite, Easing, animate, useSprite } from "./animations.jsx";
import { Card } from "./components/Card.jsx";
import "./styles.css";

const rise = animate({ from: 40, to: 0, start: 0.5, end: 2, ease: Easing.easeOutCubic });

function Title() {
  const { progress } = useSprite();
  return <h1 style={{ opacity: progress, transform: \`translateY(\${rise(0)}px)\` }}>Hello</h1>;
}

export default function Scene() {
  return (
    <Stage width={1280} height={720} duration={8} fps={30} background="#0b0b12">
      <Sprite start={0} end={8} data-layer-id="bg" data-layer-name="Background">
        <div className="bg" />
      </Sprite>
      <Sprite start={0} end={4} data-layer-id="title" data-layer-name="Title">
        <Title />
      </Sprite>
      <Sprite start={5} end={8} data-layer-id="outro">
        <Card title="Later" />
      </Sprite>
    </Stage>
  );
}
`;

const files: Record<string, ProjectFile> = buildFileTable({
  "scene.jsx": { path: "scene.jsx", kind: "jsx", content: SCENE },
  "components/Card.jsx": {
    path: "components/Card.jsx",
    kind: "jsx",
    content: `export function Card({ title }) { return <section data-layer-id="card"><b>{title}</b></section>; }`,
  },
  "styles.css": { path: "styles.css", kind: "css", content: ".bg{background:url(assets/bg.png)}" },
  "assets/bg.png": { path: "assets/bg.png", kind: "asset", content: "data:image/png;base64,AA==" },
});

const SCENE_3D = `
import React from "react";
import * as THREE from "three";
import { Stage, Sprite, Three3D } from "./animations.jsx";

export default function Scene() {
  return (
    <Stage width={1080} height={1920} duration={6} fps={30} background="#05060a">
      <Sprite start={0} end={6} data-layer-id="world" data-layer-name="3D world">
        <Three3D
          data-layer-id="three"
          data-layer-name="Boxes"
          setup={({ scene }) => { scene.add(new THREE.AmbientLight(0xffffff, 0.4)); return { revision: THREE.REVISION }; }}
          render={(t, { camera }) => { camera.position.set(0, 1, 8 - t); }}
        />
      </Sprite>
    </Stage>
  );
}
`;

function realSystem(projectFiles: Record<string, ProjectFile>, injectCss = vi.fn()) {
  return createModuleSystem({
    files: projectFiles,
    react: React,
    injectCss,
    builtins: {
      react: asEsModule(React),
      "react-dom": createReactDomShim(() => {}),
      "lucide-react": asEsModule({}),
      three: asEsModule(THREE),
      ...(Object.fromEntries(
        Object.entries(GSAP_NAMESPACES).map(([name, ns]) => [name, asEsModule(ns, (ns as { default?: unknown }).default)]),
      ) as Record<GsapModule, unknown>),
      runtime: asEsModule(runtime),
    },
  });
}

const SCENE_GSAP = `
import React from "react";
import gsap from "gsap";
import { SplitText } from "gsap/SplitText";
import { Stage, Sprite, useGsapTimeline } from "./animations.jsx";

function Headline() {
  const ref = useGsapTimeline((tl) => {
    const split = SplitText.create("h1", { type: "chars" });
    tl.from(split.chars, { yPercent: 100, stagger: 0.05, duration: 0.6 });
  });
  return <div ref={ref}><h1>Move it</h1></div>;
}

export const engine = gsap.version;
export default function Scene() {
  return (
    <Stage width={1080} height={1920} duration={4} fps={30}>
      <Sprite start={0.5} end={4} data-layer-id="headline" data-layer-name="Headline">
        <Headline />
      </Sprite>
    </Stage>
  );
}
`;

describe("module system + real runtime", () => {
  it("evaluates a contract-style scene and renders the expected stage markup", () => {
    const injectCss = vi.fn();
    const system = realSystem(files, injectCss);
    const Scene = (system.load("scene.jsx") as { default: React.ComponentType }).default;
    const html = renderToStaticMarkup(React.createElement(Scene));

    expect(html).toContain('data-stage=""');
    expect(html).toMatch(/width:1280px;height:720px;overflow:hidden;background:#0b0b12/);
    expect(html).toContain('data-layer-id="bg"');
    expect(html).toContain('data-layer-name="Background"');
    expect(html).toContain("translateY(40px)");
    expect(html).toContain("opacity:0");
    // outro sprite starts at 5s: not rendered at t = 0
    expect(html).not.toContain('data-layer-id="outro"');
    expect(html).not.toContain("Later");
    expect(injectCss).toHaveBeenCalledWith("styles.css", '.bg{background:url("data:image/png;base64,AA==")}');
  });

  it("loads a three.js scene: <Three3D> is one stage-sized layer element (WebGL starts only in the browser)", () => {
    const system = realSystem(buildFileTable({ "scene.jsx": { path: "scene.jsx", kind: "jsx", content: SCENE_3D } }));
    const Scene = (system.load("scene.jsx") as { default: React.ComponentType }).default;
    const html = renderToStaticMarkup(React.createElement(Scene));

    expect(html).toMatch(/<div data-three3d="" data-layer-id="three" data-layer-name="Boxes" style="[^"]*width:1080px;height:1920px/);
    // the canvas and renderer are created in a layout effect, which never runs on the server
    expect(html).not.toContain("<canvas");
  });

  it("loads a GSAP scene with the real gsap, its plugins and the runtime's useGsapTimeline", () => {
    const system = realSystem(buildFileTable({ "scene.jsx": { path: "scene.jsx", kind: "jsx", content: SCENE_GSAP } }));
    const exports = system.load("scene.jsx") as { default: React.ComponentType; engine: string };
    expect(exports.engine).toBe("3.15.0");
    setClock({ time: 1 }); // inside the headline Sprite's window (0.5–4 s)
    const html = renderToStaticMarkup(React.createElement(exports.default));
    resetClock();
    // timelines are built in layout effects, which never run on the server: plain markup
    expect(html).toContain('data-layer-id="headline"');
    expect(html).toContain("<h1>Move it</h1>");
  });
});

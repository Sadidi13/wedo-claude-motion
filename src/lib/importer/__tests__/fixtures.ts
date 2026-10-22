/** Shared fixtures for the importer tests: HTML pages, scene sources and a 1×1 PNG. */
import { base64ToBytes } from "../dataUrl";

/** A real 1×1 transparent PNG. */
export const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
export const PNG_BYTES = base64ToBytes(PNG_BASE64);

/** A scene in the CONTRACTS §1 style with every id present (should import byte-for-byte). */
export const CLEAN_SCENE = `import React from "react";
import { Stage, Sprite, useTime, useSprite, Easing, interpolate, animate } from "./animations.jsx";

export default function Scene() {
  return (
    <Stage width={1280} height={720} duration={8} fps={30} background="#0b0b12">
      <Sprite start={0} end={8} data-layer-id="bg" data-layer-name="Background">
        <div data-layer-id="bg-fill" style={{ position: "absolute", inset: 0, background: "#111" }} />
      </Sprite>
      <Sprite start={0.5} end={4} data-layer-id="title" data-layer-name="Title">
        {({ progress }) => (
          <h1 data-layer-id="title-h1" style={{ opacity: progress }}>
            Hello
          </h1>
        )}
      </Sprite>
    </Stage>
  );
}
`;

/** Same scene, no ids, no `export default`. */
export const BARE_SCENE = CLEAN_SCENE.replace(/ data-layer-id="[^"]*"/g, "").replace("export default function Scene", "function Scene");

/** Claude-Design-style page: CDN scripts, fonts, inline style, one text/babel module script. */
export const BABEL_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Nova &amp; friends</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" rel="stylesheet">
<style>
  body { margin: 0; }
  .title { color: red; }
</style>
<script src="https://unpkg.com/react@18/umd/react.development.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<script src="https://cdn.tailwindcss.com"></script>
<script type="importmap">{ "imports": { "react": "https://esm.sh/react" } }</script>
</head>
<body>
<div id="root"></div>
<!-- <script>alert("commented out")</script> -->
<script type="text/babel" data-type="module">
import React from "react";
import { Stage, Sprite } from "./animations.jsx";

function Scene() {
  return (
    <Stage width={1280} height={720} duration={6} fps={24} background="#000">
      <Sprite start={0} end={6}>
        <h1 className="title">Hi</h1>
      </Sprite>
    </Stage>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Scene />);
</script>
</body>
</html>
`;

/** Babel-standalone page without a Stage: globals React / ReactDOM, meta from window.__videoMeta. */
export const NO_STAGE_PAGE = `<html>
<head>
<script>window.__videoMeta = { width: 1080, height: 1920, duration: 12, fps: 60 };</script>
</head>
<body>
<div id="root"></div>
<script type="text/babel">
const { useState } = React;
function App() {
  return <div className="box">Hello</div>;
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
</script>
</body>
</html>
`;

/** No React at all: static markup, a DOM script and hz:canvas hints. */
export const STATIC_PAGE = `<html>
<head>
<meta name="hz:canvas-width" content="800">
<meta name="hz:canvas-height" content="600">
<style>.card { color: #fff }</style>
</head>
<body>
<div class="card"><h1>Static title</h1><p>Body "quoted"</p></div>
<script>document.querySelector("h1").style.color = "red";</script>
</body>
</html>
`;

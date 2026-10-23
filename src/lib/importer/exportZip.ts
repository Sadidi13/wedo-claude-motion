/**
 * exportProjectZip — round-trip archive of a Project (CONTRACTS §7): every
 * project file at its path (assets decoded from data URLs back to binary),
 * a `manifest.json` that importFromZip recognises, a small standalone
 * `index.html` shell and a README that says plainly what the shell needs.
 */
import JSZip from "jszip";
import { PRODUCT_NAME } from "@/lib/brand";
import type { Project } from "@/lib/types";
import { dataUrlToBytes } from "./dataUrl";
import { normaliseProjectPath } from "./files";

export const MANIFEST_GENERATOR = "motion-studio";

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);
}

/** A viewer shell: React 19 from esm.sh via an import map, honest about what it cannot do alone. */
function standaloneIndexHtml(project: Project): string {
  const title = escapeHtml(project.name);
  const entry = `./${normaliseProjectPath(project.entry)}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — ${PRODUCT_NAME} export</title>
<script type="importmap">
{
  "imports": {
    "react": "https://esm.sh/react@19",
    "react-dom": "https://esm.sh/react-dom@19",
    "react-dom/client": "https://esm.sh/react-dom@19/client",
    "lucide-react": "https://esm.sh/lucide-react?deps=react@19"
  }
}
</script>
<style>
  html, body { margin: 0; background: ${project.meta.background ?? "#0b0b12"}; color: #e8e8f0; font: 14px/1.5 system-ui, sans-serif; }
  #root { position: relative; }
  #note { max-width: 720px; padding: 24px; }
  #note pre { white-space: pre-wrap; color: #ffb4b4; }
</style>
</head>
<body>
<div id="root"></div>
<div id="note" hidden>
  <h1>This export needs a build step to play here</h1>
  <p>The scene source is <code>${escapeHtml(entry)}</code> (JSX). Browsers cannot run JSX directly and the
  Claude Motion runtime it imports (<code>./animations.jsx</code>) is not part of this archive. Either
  compile the scene with Babel / esbuild and place a compatible <code>animations.jsx</code> next to it,
  or re-import this zip into Motion Studio, which previews and edits it without any build step.</p>
  <pre></pre>
</div>
<script type="module">
  import React from "react";
  import { createRoot } from "react-dom/client";
  const note = document.getElementById("note");
  try {
    const mod = await import(${JSON.stringify(entry)});
    if (typeof mod.default !== "function") throw new Error("the scene has no default export component");
    createRoot(document.getElementById("root")).render(React.createElement(mod.default));
  } catch (error) {
    note.hidden = false;
    note.querySelector("pre").textContent = String((error && error.message) || error);
  }
</script>
</body>
</html>
`;
}

function readme(project: Project): string {
  return `${project.name} — Motion Studio project archive

Contents
  ${normaliseProjectPath(project.entry)}   the scene (JSX: one <Stage> with <Sprite> layers, a pure function of time)
  manifest.json   name, dates, entry file, stage meta ({ width, height, duration, fps })
  assets/…        images, fonts and media referenced by the scene (binary, as exported)
  index.html      a minimal viewer shell (see below)

How to use it
  Import this zip into Motion Studio ("Import" → choose the .zip). Motion Studio reads manifest.json,
  restores every file and layer id, and previews the scene with its built-in runtime. That is the
  supported round trip.

About index.html
  It loads React 19 from esm.sh through an import map and tries to render the scene. It cannot work
  on its own: browsers do not execute JSX, and the runtime the scene imports ("./animations.jsx",
  the Claude Motion Stage / Sprite / useTime API) is not bundled in this archive. To run it outside
  Motion Studio, compile the scene to plain JavaScript and provide a compatible animations.jsx.
`;
}

export async function exportProjectZip(project: Project): Promise<Blob> {
  const zip = new JSZip();
  const paths: string[] = [];
  for (const file of Object.values(project.files)) {
    const path = normaliseProjectPath(file.path);
    if (!path) continue;
    if (file.kind === "asset" && file.content.startsWith("data:")) zip.file(path, dataUrlToBytes(file.content).bytes);
    else zip.file(path, file.content);
    paths.push(path);
  }

  const manifest = {
    generator: MANIFEST_GENERATOR,
    version: 1,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    entry: normaliseProjectPath(project.entry),
    meta: project.meta,
    origin: project.origin,
    files: paths,
  };
  zip.file("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  if (!paths.includes("index.html")) zip.file("index.html", standaloneIndexHtml(project));
  if (!paths.includes("README.txt")) zip.file("README.txt", readme(project));

  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return new Blob([new Uint8Array(bytes)], { type: "application/zip" });
}

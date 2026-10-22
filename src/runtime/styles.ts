/**
 * The runtime's injected stylesheet. Added to <head> once per document when
 * the first <Stage> mounts (plus a render-mode addendum when exporting).
 *
 * Besides the `data-hidden` / `data-export-hide` rules from CONTRACTS.md §1 it
 * neutralises the host app's Tailwind preflight inside the stage: the preview
 * page lives under the editor's root layout, whose `globals.css` resets
 * headings, images, buttons, box-sizing … in `@layer base`. Reverting that
 * layer for everything inside `[data-stage]` makes a scene render the way it
 * does in a plain HTML document (which is what Claude Motion exports assume),
 * while the project's own unlayered CSS and inline styles still win.
 */

const BASE_STYLE_ID = "motion-runtime-style";
const RENDER_STYLE_ID = "motion-runtime-render-style";

const BASE_CSS = `
@layer base {
  [data-stage], [data-stage] *, [data-stage] *::before, [data-stage] *::after { all: revert-layer; }
}
[data-stage] [data-hidden="true"] { display: none !important; }
`;

const RENDER_CSS = `
[data-stage] [data-export-hide] { display: none !important; }
html, body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; }
`;

function injectOnce(id: string, css: string): void {
  if (typeof document === "undefined" || document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}

export function ensureRuntimeStyles(renderMode: boolean): void {
  injectOnce(BASE_STYLE_ID, BASE_CSS);
  if (renderMode) injectOnce(RENDER_STYLE_ID, RENDER_CSS);
}

# /preview — runtime host page

Client-only page that evaluates a `Project` with `src/lib/loader` and mounts the `src/runtime` Stage. Three modes, picked from the URL and whether the page sits in an iframe:

| mode | when | behaviour |
|---|---|---|
| **embed** | no `?__render`, inside an iframe (the editor canvas) | `window.__EMBED = true`; waits for `{type:"load"}` postMessages and answers `seek` / `getLayerRects` / `highlight` / `setTransparent`; posts `ready`, `layerRects`, `select` (click on the deepest `[data-layer-id]`, `null` for empty area), `error`, `warning`. Messages are only accepted from and posted to `window.location.origin`. |
| **render** | `?__render=1` (headless export, usually with `?job=<id>` and optionally `?transparent=1`) | `window.__RENDER_MODE = true`; bare stage at the top-left origin, transparent document, no overlay, `[data-export-hide]` hidden. The renderer waits for `window.__ready` and drives `window.__seek(t)`. |
| **standalone** | opened directly, not in an iframe | the runtime plays the scene with its own scrubber / keyboard / scale-to-fit; the project comes from `?job=` or from the editor's last autosave in `localStorage`. |

Loading always happens into a fresh mount next to the current one; the previous frame is replaced only after the new project rendered its first frame, so a broken edit keeps the last good frame visible and the editor shows the `error`.

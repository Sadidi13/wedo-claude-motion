/**
 * Web-font readiness for runtime helpers that measure or bake text once
 * (<Three3D> canvas textures, GSAP SplitText): they must not run before the
 * fonts the page uses have loaded, or the result differs between the editor
 * and the export. While waiting, the frame is held (pending.ts) so the export
 * renderer does not capture it early.
 */

import { useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { holdFrame } from "./pending";

/** True when no web font is still loading (always true on the server, where effects never run). */
export function fontsLoaded(): boolean {
  return typeof document === "undefined" || !document.fonts || document.fonts.status === "loaded";
}

/** False until `document.fonts.ready` resolves; the frame is held meanwhile. */
export function useFontsReady(): boolean {
  const [ready, setReady] = useState(fontsLoaded);
  useLayoutEffect(() => {
    if (ready) return;
    const release = holdFrame();
    let cancelled = false;
    void document.fonts.ready.then(() => {
      try {
        // flushSync: whatever waited on the fonts has rendered before the hold is released.
        if (!cancelled) flushSync(() => setReady(true));
      } finally {
        release();
      }
    });
    return () => {
      cancelled = true;
      release();
    };
  }, [ready]);
  return ready;
}

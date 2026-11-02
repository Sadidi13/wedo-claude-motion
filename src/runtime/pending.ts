/**
 * Pending work that the current frame depends on (CONTRACTS.md §1, §6).
 *
 * Most of a scene renders synchronously inside `window.__seek(t)`. A few
 * things cannot: <Three3D> decodes its `textures` images before it draws.
 * Such work calls `holdFrame()` and releases the hold once the frame is drawn;
 * `whenIdle()` (installed as `window.__whenIdle`) resolves when no hold is
 * left. The export renderer awaits it after every seek, so a frame is never
 * captured before its textures are on screen. The editor preview ignores it.
 */

let holds = 0;
let waiters: (() => void)[] = [];

/** Mark the current frame as incomplete. The returned function releases the hold (idempotent). */
export function holdFrame(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    if (holds > 0) return;
    const resolved = waiters;
    waiters = [];
    for (const resolve of resolved) resolve();
  };
}

/** Resolves once every hold has been released (immediately when there is none). */
export function whenIdle(): Promise<void> {
  if (holds === 0) return Promise.resolve();
  return new Promise((resolve) => waiters.push(resolve));
}

/** A frame waits at most this long for images and fonts; a file that never loads then renders as missing. */
const SETTLE_TIMEOUT_MS = 10_000;

/**
 * What the export renderer awaits after every seek (`window.__whenIdle`): the holds, then what the
 * browser loads by itself. An <img> a Sprite has just mounted (a logo from the media library) and
 * a font that text on this frame is the first to use both arrive after the seek; without waiting,
 * the first frame of a layer (and of every render worker) would be captured without them.
 */
export async function whenSettled(): Promise<void> {
  await whenIdle();
  if (typeof document === "undefined") return;
  // One frame of layout first, so text in a font nobody used yet starts loading it.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const loading = Array.from(document.images)
    .filter((image) => !image.complete)
    .map((image) => image.decode().catch(() => undefined));
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all([...loading, document.fonts?.ready]),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, SETTLE_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timer);
}

/** Number of unreleased holds (tests). */
export function pendingHolds(): number {
  return holds;
}

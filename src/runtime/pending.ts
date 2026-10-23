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

/** Number of unreleased holds (tests). */
export function pendingHolds(): number {
  return holds;
}

/**
 * Frame holds (pending.ts): the export renderer awaits `window.__whenIdle()`
 * after every seek, so it must resolve only once every hold is released, and
 * releasing twice must not unbalance the count.
 */
import { describe, expect, it } from "vitest";
import { holdFrame, pendingHolds, whenIdle } from "../pending";

async function settled(promise: Promise<void>): Promise<boolean> {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  return done;
}

describe("holdFrame / whenIdle", () => {
  it("resolves immediately when nothing is pending", async () => {
    expect(pendingHolds()).toBe(0);
    expect(await settled(whenIdle())).toBe(true);
  });

  it("waits for every hold, and a double release counts once", async () => {
    const releaseA = holdFrame();
    const releaseB = holdFrame();
    const idle = whenIdle();
    expect(pendingHolds()).toBe(2);

    releaseA();
    releaseA();
    expect(pendingHolds()).toBe(1);
    expect(await settled(idle)).toBe(false);

    releaseB();
    expect(pendingHolds()).toBe(0);
    expect(await settled(idle)).toBe(true);
  });
});

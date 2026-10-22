/** setStageMeta: literal Stage props edited in place or appended. */
import { describe, expect, it } from "vitest";
import { parseScene, setStageMeta } from "../index";
import { FIXTURE } from "./fixture";

describe("setStageMeta", () => {
  it("edits existing props in place and leaves everything else byte-identical", () => {
    const next = setStageMeta(FIXTURE, { width: 1920, duration: 12.5, background: "#fff" });
    expect(next).toBe(
      FIXTURE.replace(
        '<Stage width={1280} height={720} duration={8} fps={30} background="#0b0b12">',
        '<Stage width={1920} height={720} duration={12.5} fps={30} background="#fff">',
      ),
    );
    expect(parseScene(next).meta).toEqual({ width: 1920, height: 720, duration: 12.5, fps: 30, background: "#fff" });
  });

  it("adds background (and other props) when missing, after the last attribute", () => {
    const noBg = FIXTURE.replace(' background="#0b0b12"', "");
    expect(parseScene(noBg).meta.background).toBeUndefined();
    const next = setStageMeta(noBg, { background: "linear-gradient(#000, #111)" });
    expect(next).toContain('<Stage width={1280} height={720} duration={8} fps={30} background="linear-gradient(#000, #111)">');
    const bare = noBg.replace("<Stage width={1280} height={720} duration={8} fps={30}>", "<Stage>");
    const filled = setStageMeta(bare, { fps: 60, width: 640, background: "" });
    expect(filled).toContain('<Stage width={640} fps={60} background="">');
    expect(parseScene(filled).meta).toEqual({ width: 640, height: 720, duration: 10, fps: 60, background: "" });
  });

  it("ignores undefined keys and rejects non-finite numbers", () => {
    expect(setStageMeta(FIXTURE, {})).toBe(FIXTURE);
    expect(setStageMeta(FIXTURE, { width: undefined })).toBe(FIXTURE);
    expect(() => setStageMeta(FIXTURE, { fps: Number.POSITIVE_INFINITY })).toThrow(/finite/);
  });
});

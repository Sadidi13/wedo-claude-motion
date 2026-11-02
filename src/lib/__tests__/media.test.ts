import { describe, expect, it } from "vitest";
import { frameAt, isVideoFileName, mediaIdOf, mediaIdsIn, mediaKindForName, mediaKindOf, mediaRef } from "../media";

describe("media references", () => {
  it("reads the id of a media/<id>[.ext] reference", () => {
    expect(mediaIdOf("media/k3f9x2abcd12.mp4")).toBe("k3f9x2abcd12");
    expect(mediaIdOf("./media/k3f9x2abcd12.mov")).toBe("k3f9x2abcd12");
    expect(mediaIdOf("media/k3f9x2abcd12")).toBe("k3f9x2abcd12");
    expect(mediaIdOf(mediaRef("k3f9x2abcd12", "webm"))).toBe("k3f9x2abcd12");
  });

  it("rejects anything else", () => {
    expect(mediaIdOf("/media/wedo-sora/f/f_0001.jpg")).toBeNull();
    expect(mediaIdOf("assets/clip.mp4")).toBeNull();
    expect(mediaIdOf("media/K3F9X2ABCD12.mp4")).toBeNull();
    expect(mediaIdOf("media/short.mp4")).toBeNull();
    expect(mediaIdOf("media/k3f9x2abcd12/../x")).toBeNull();
    expect(mediaIdOf(undefined)).toBeNull();
  });

  it("lists the ids a scene mentions, once each", () => {
    const code = '<Video src="media/k3f9x2abcd12.mp4" />\n<Video src="media/k3f9x2abcd12.mp4" from={4} />\nconst b = "media/zz99yy88xx77.mov";';
    expect(mediaIdsIn(code)).toEqual(["k3f9x2abcd12", "zz99yy88xx77"]);
    expect(mediaIdsIn('src="/media/wedo-sora/f/f_0001.jpg"')).toEqual([]);
  });

  it("recognises video file names", () => {
    expect(isVideoFileName("Talk.MP4")).toBe(true);
    expect(isVideoFileName("clip.mov")).toBe(true);
    expect(isVideoFileName("song.mp3")).toBe(false);
  });

  it("gives every file the library takes its kind", () => {
    expect(mediaKindForName("Talk.MP4")).toBe("video");
    expect(mediaKindForName("voice over.m4a")).toBe("audio");
    expect(mediaKindForName("logo.SVG")).toBe("image");
    expect(mediaKindForName("Vazirmatn-Bold.woff2")).toBe("font");
    expect(mediaKindForName("notes.txt")).toBeNull();
    expect(mediaKindForName("no-extension")).toBeNull();
    expect(mediaKindOf({})).toBe("video");
    expect(mediaKindOf({ kind: "font" })).toBe("font");
  });
});

describe("frameAt", () => {
  const meta = { frameRate: 30, frameCount: 1390 };

  it("maps source seconds to the frame shown at that time", () => {
    expect(frameAt(meta, 0)).toBe(0);
    expect(frameAt(meta, 1)).toBe(30);
    expect(frameAt(meta, 1.6)).toBe(48);
    expect(frameAt(meta, 1 / 30 - 1e-9)).toBe(1); // float noise does not drop a frame
  });

  it("clamps to the frames that exist", () => {
    expect(frameAt(meta, -2)).toBe(0);
    expect(frameAt(meta, 999)).toBe(1389);
    expect(frameAt({ frameRate: 30, frameCount: 0 }, 5)).toBe(0);
  });
});

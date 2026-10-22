import { describe, expect, it } from "vitest";
import { detectPreviewMode } from "../mode";

describe("detectPreviewMode", () => {
  it("prefers render, then embed, then standalone", () => {
    expect(detectPreviewMode({ render: true, inIframe: true })).toBe("render");
    expect(detectPreviewMode({ render: true, inIframe: false })).toBe("render");
    expect(detectPreviewMode({ render: false, inIframe: true })).toBe("embed");
    expect(detectPreviewMode({ render: false, inIframe: false })).toBe("standalone");
  });
});

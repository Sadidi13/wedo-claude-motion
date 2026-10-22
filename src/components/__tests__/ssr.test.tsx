/**
 * SSR smoke test: Next pre-renders the client page, so the whole editor must
 * render with react-dom/server without touching window / localStorage. The
 * first render is the empty shell (no project yet); effects load it later.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "@/app/page";
import { useEditorStore } from "@/store/editorStore";

describe("editor page SSR", () => {
  it("renders the empty shell on the server", () => {
    expect(useEditorStore.getState().project).toBeNull();
    const html = renderToStaticMarkup(<Home />);
    expect(html).toContain("Motion Studio");
    expect(html).toContain('aria-label="Layers"');
    expect(html).toContain('aria-label="Inspector"');
    expect(html).toContain('aria-label="Timeline tracks"');
    expect(html).toContain("Loading project");
    expect(html).not.toContain("<iframe");
  });
});

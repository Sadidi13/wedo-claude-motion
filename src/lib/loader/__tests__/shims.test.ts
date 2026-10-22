import { describe, expect, it } from "vitest";
import { asEsModule, createReactDomShim } from "../shims";

describe("asEsModule", () => {
  it("copies named exports and adds default + __esModule", () => {
    const mod = asEsModule({ a: 1, b: 2 });
    expect(mod.a).toBe(1);
    expect(mod.__esModule).toBe(true);
    expect(mod.default).toEqual({ a: 1, b: 2 });
  });

  it("accepts an explicit default export", () => {
    const def = () => "x";
    expect(asEsModule({ def }, def).default).toBe(def);
  });
});

describe("createReactDomShim", () => {
  it("captures the node from createRoot().render", () => {
    const captured: unknown[] = [];
    const shim = createReactDomShim((node) => captured.push(node));
    const dom = shim.default as { createRoot: (el: unknown) => { render: (n: unknown) => void; unmount: () => void } };
    const root = dom.createRoot(null);
    root.render("A");
    root.unmount();
    expect(captured).toEqual(["A"]);
  });

  it("captures from legacy render and hydrateRoot", () => {
    const captured: unknown[] = [];
    const shim = createReactDomShim((node) => captured.push(node));
    (shim.render as (node: unknown, el: unknown) => void)("B", null);
    (shim.hydrateRoot as (el: unknown, node: unknown) => void)(null, "C");
    expect(captured).toEqual(["B", "C"]);
    expect(shim.__esModule).toBe(true);
  });
});

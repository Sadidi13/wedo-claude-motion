import { describe, expect, it } from "vitest";
import { compileFile } from "../compile";
import { LoadError } from "../errors";

describe("compileFile", () => {
  it("compiles JSX to React.createElement and ESM to require/exports", () => {
    const out = compileFile(
      "scene.jsx",
      `import React from "react";
import { Stage, Sprite } from "./animations.jsx";
export default function Scene() {
  return <Stage width={1280}><Sprite start={0} end={2} data-layer-id="a"><h1>Hi</h1></Sprite></Stage>;
}`,
    );
    expect(out).toContain("require('react')");
    expect(out).toContain("require('./animations.jsx')");
    expect(out).toContain(".createElement(");
    expect(out).toContain("'data-layer-id': \"a\"");
    expect(out).toContain("exports.default = Scene");
    expect(out).not.toContain("<Stage");
  });

  it("uses the React free variable when the file does not import React", () => {
    const out = compileFile("s.jsx", `export default () => <div />`);
    expect(out).toContain("React.createElement('div'");
  });

  it("strips TypeScript and keeps side-effect / unused imports", () => {
    const out = compileFile(
      "Card.tsx",
      `import styles from "./styles.css";
import "./reset.css";
export const n: number = 1;
export function Card(props: { title: string }): JSX.Element { return <b>{props.title}</b>; }`,
    );
    expect(out).toContain("require('./styles.css')");
    expect(out).toContain("require('./reset.css')");
    expect(out).not.toContain(": number");
    expect(out).toContain("exports.n = n");
  });

  it("wraps syntax errors in a LoadError that names the file", () => {
    let caught: unknown;
    try {
      compileFile("bad.jsx", "export default function S() { return <div> }");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LoadError);
    expect((caught as LoadError).file).toBe("bad.jsx");
    expect((caught as LoadError).message).toContain("bad.jsx");
  });
});

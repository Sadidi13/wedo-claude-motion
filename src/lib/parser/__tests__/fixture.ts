/**
 * Shared test fixture: a scene written exactly in the CONTRACTS §1 style —
 * two plain Sprites, nested elements, a function-child Sprite, a `.map()`,
 * a `&&` conditional child, a Sprite with no `end`, a nested Sprite whose
 * range exceeds its parent, and a helper component with JSX OUTSIDE the
 * Stage (must never become a layer).
 */
import { expect } from "vitest";
import { listLayerIds, parseScene } from "../index";

export const FIXTURE = `import React from "react";
import { Stage, Sprite, useTime, useSprite, Easing, interpolate, animate } from "./animations.jsx";

const FEATURES = ["Fast", "Secure", "Simple"];

function Badge({ label }) {
  return <span className="badge">{label}</span>;
}

export default function Scene() {
  const t = useTime();
  return (
    <Stage width={1280} height={720} duration={8} fps={30} background="#0b0b12">
      <Sprite start={0} end={8} data-layer-id="bg" data-layer-name="Background">
        <div data-layer-id="bg-fill" style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg,#111,#223)" }} />
      </Sprite>
      <Sprite start={0.5} end={4} data-layer-id="title" data-layer-name="Title">
        {({ progress }) => (
          <h1 data-layer-id="title-h1" style={{ opacity: progress, transform: \`translateY(\${(1 - Easing.easeOutCubic(progress)) * 40}px)\` }}>
            Hello
          </h1>
        )}
      </Sprite>
      <Sprite start={2} end={6} data-layer-id="cards">
        <div data-layer-id="row" className="row">
          {FEATURES.map((f, i) => (
            <div key={f} data-layer-id="card" className="card" style={{ opacity: animate({ from: 0, to: 1, start: 2 + i * 0.2, end: 2.6 + i * 0.2 })(t) }}>
              <Badge data-layer-id="badge" label={f} />
              <p data-layer-id="card-text">{f}</p>
            </div>
          ))}
          <Sprite start={3} end={10} data-layer-id="logo-sprite">
            <img data-layer-id="logo" src="assets/logo.png" alt="logo" />
          </Sprite>
        </div>
      </Sprite>
      <Sprite start={6} data-layer-id="outro">
        <div data-layer-id="outro-box">
          <h2 data-layer-id="outro-title">Get started today with Motion Studio</h2>
          {t > 7 && <p data-layer-id="outro-note">Now</p>}
        </div>
      </Sprite>
    </Stage>
  );
}
`;

/** The same scene with every data-layer-id stripped (input for ensureLayerIds). */
export const FIXTURE_NO_IDS = FIXTURE.replace(/ data-layer-id="[^"]*"/g, "");

/** Ids in the fixture, in source order. */
export const FIXTURE_IDS = [
  "bg",
  "bg-fill",
  "title",
  "title-h1",
  "cards",
  "row",
  "card",
  "badge",
  "card-text",
  "logo-sprite",
  "logo",
  "outro",
  "outro-box",
  "outro-title",
  "outro-note",
];

/** Generated id shape: `${tagSlug}-${6 lowercase alphanumerics}`. */
export const GENERATED_ID = /^[a-z0-9]+-[a-z0-9]{6}$/;

/** Asserts the source still parses and that no layer id is duplicated. */
export function expectCleanScene(source: string) {
  const scene = parseScene(source);
  const ids = listLayerIds(source);
  expect(new Set(ids).size).toBe(ids.length);
  expect(scene.warnings.filter((w) => w.includes("no data-layer-id") || w.includes("Duplicate"))).toEqual([]);
  return scene;
}

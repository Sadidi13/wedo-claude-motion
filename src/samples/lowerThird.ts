/**
 * Lower third — bundled sample scene (CONTRACTS §7), stored as the raw scene.jsx
 * source so it loads through the same path as an imported Claude Motion file.
 * Written in the CONTRACTS §1 style: one <Stage>, every top-level element a
 * named <Sprite> with a stable data-layer-id, all motion a pure function of time.
 */
export const LOWER_THIRD_SOURCE = `import React from "react";
import { Stage, Sprite, useTime, Easing, animate } from "./animations.jsx";

// Lower third — Motion Studio sample (1920×1080, 5 s, 30 fps).
// A name / title plate slides in from the left, holds, and slides out again.
// Export with a transparent background to overlay it on footage.

const FONT = "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif";
const ACCENT = "#ffb347";
const SLIDE_IN = 0.7;
const SLIDE_OUT_AT = 4.1;

/** 0 → 1 while entering (from \`delay\`), holds at 1, then 1 → 0 while leaving. A pure function of time. */
function presence(t, delay) {
  const enter = animate({ from: 0, to: 1, start: delay, end: delay + SLIDE_IN, ease: Easing.easeOutExpo })(t);
  const leave = animate({
    from: 1,
    to: 0,
    start: SLIDE_OUT_AT + delay * 0.5,
    end: SLIDE_OUT_AT + 0.55 + delay * 0.5,
    ease: Easing.easeInCubic,
  })(t);
  return Math.min(enter, leave);
}

export default function Scene() {
  const t = useTime();
  const bar = presence(t, 0);
  const plate = presence(t, 0.08);
  const name = presence(t, 0.22);
  const role = presence(t, 0.34);
  const rule = presence(t, 0.5);
  return (
    <Stage width={1920} height={1080} duration={5} fps={30} background="#101418">
      <Sprite start={0} end={5} data-layer-id="sprite-accent" data-layer-name="Accent bar">
        <div
          data-layer-id="div-accent"
          style={{
            position: "absolute",
            left: 120,
            top: 790,
            width: 14,
            height: 150,
            borderRadius: 7,
            background: ACCENT,
            transformOrigin: "50% 100%",
            transform: \`scaleY(\${bar})\`,
            opacity: bar,
          }}
        />
      </Sprite>

      <Sprite start={0.08} end={5} data-layer-id="sprite-plate" data-layer-name="Name plate">
        <div
          data-layer-id="div-plate"
          style={{
            position: "absolute",
            left: 158,
            top: 790,
            width: 820,
            height: 150,
            borderRadius: 18,
            background: "rgba(10,12,18,0.72)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 30px 60px rgba(0,0,0,0.4)",
            transform: \`translateX(\${(plate - 1) * 980}px)\`,
            opacity: plate,
          }}
        />
      </Sprite>

      <Sprite start={0.22} end={5} data-layer-id="sprite-name" data-layer-name="Name">
        <div
          data-layer-id="div-name"
          style={{
            position: "absolute",
            left: 196,
            top: 812,
            fontFamily: FONT,
            fontSize: 54,
            fontWeight: 800,
            lineHeight: 1.1,
            letterSpacing: "-0.015em",
            color: "#ffffff",
            whiteSpace: "nowrap",
            opacity: name,
            transform: \`translateX(\${(name - 1) * 60}px)\`,
          }}
        >
          Maya Chen
        </div>
      </Sprite>

      <Sprite start={0.34} end={5} data-layer-id="sprite-role" data-layer-name="Role">
        <div
          data-layer-id="div-role"
          style={{
            position: "absolute",
            left: 196,
            top: 884,
            fontFamily: FONT,
            fontSize: 26,
            fontWeight: 500,
            letterSpacing: "0.02em",
            color: "rgba(255,255,255,0.7)",
            whiteSpace: "nowrap",
            opacity: role,
            transform: \`translateX(\${(role - 1) * 40}px)\`,
          }}
        >
          Head of Motion Design · Nova
        </div>
      </Sprite>

      <Sprite start={0.5} end={5} data-layer-id="sprite-rule" data-layer-name="Underline">
        <div
          data-layer-id="div-rule"
          style={{
            position: "absolute",
            left: 196,
            top: 868,
            width: 744,
            height: 2,
            background: \`linear-gradient(90deg, \${ACCENT}, rgba(255,179,71,0))\`,
            transformOrigin: "0 50%",
            transform: \`scaleX(\${rule})\`,
          }}
        />
      </Sprite>
    </Stage>
  );
}
`;

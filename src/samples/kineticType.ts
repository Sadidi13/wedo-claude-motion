/**
 * Kinetic type — bundled sample scene (CONTRACTS §7), stored as the raw
 * scene.jsx source so it loads through the same path as an imported Claude
 * Motion file. Shows the GSAP contract (CONTRACTS §1 "GSAP"): each animated
 * block is a component inside its own Sprite whose useGsapTimeline builds one
 * paused timeline (SplitText, DrawSVG, TextPlugin) that the runtime seeks to
 * the Sprite's local time. The Sprite bars stay draggable on the timeline.
 */
export const KINETIC_TYPE_SOURCE = `import React from "react";
import { SplitText } from "gsap/SplitText";
import { Stage, Sprite, useGsapTimeline } from "./animations.jsx";

// Kinetic type — Motion Studio sample (1080×1920, 5 s, 30 fps).
// A kicker types itself in, the headline rises letter by letter, a hand-drawn stroke underlines it,
// and the subtitle follows word by word. GSAP timing lives in code; each Sprite's start is time 0.

const FONT = "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif";
const ACCENT = "#ff5a36";

function Kicker(props) {
  const ref = useGsapTimeline((tl) => {
    tl.to(".kicker", { text: "GSAP · SPLITTEXT · DRAWSVG", duration: 0.9, ease: "none" });
  });
  return (
    <div ref={ref} {...props} style={{ position: "absolute", left: 96, top: 640 }}>
      <p className="kicker" style={{ margin: 0, color: "rgba(255,255,255,0.7)", font: \`700 30px/1 \${FONT}\`, letterSpacing: 6 }} />
    </div>
  );
}

function Headline(props) {
  const ref = useGsapTimeline((tl) => {
    const split = SplitText.create(".headline", { type: "chars,words", mask: "chars" });
    tl.from(split.chars, { yPercent: 115, rotate: 8, duration: 0.75, ease: "power4.out", stagger: 0.03 });
  });
  return (
    <div ref={ref} {...props} style={{ position: "absolute", left: 90, right: 90, top: 700 }}>
      <h1 className="headline" style={{ margin: 0, color: "#ffffff", font: \`800 150px/1.02 \${FONT}\`, letterSpacing: -3 }}>
        Make every frame move
      </h1>
    </div>
  );
}

function Underline(props) {
  const ref = useGsapTimeline((tl) => {
    tl.fromTo(".stroke", { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.8, ease: "power2.inOut" });
  });
  return (
    <div ref={ref} {...props} style={{ position: "absolute", left: 80, top: 1040, width: 760, height: 80 }}>
      <svg viewBox="0 0 760 80" width="760" height="80">
        <path className="stroke" d="M10 52 C 180 18, 330 70, 470 38 S 700 22, 750 44" fill="none" stroke={ACCENT} strokeWidth="12" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function Subtitle(props) {
  const ref = useGsapTimeline((tl) => {
    const split = SplitText.create(".subtitle", { type: "words" });
    tl.from(split.words, { opacity: 0, y: 24, duration: 0.5, ease: "power3.out", stagger: 0.07 });
  });
  return (
    <div ref={ref} {...props} style={{ position: "absolute", left: 96, right: 96, top: 1150 }}>
      <p className="subtitle" style={{ margin: 0, color: "rgba(255,255,255,0.82)", font: \`500 48px/1.3 \${FONT}\` }}>
        GSAP timelines scrub with the playhead and export frame by frame.
      </p>
    </div>
  );
}

export default function Scene() {
  return (
    <Stage width={1080} height={1920} duration={5} fps={30} background="#0b0b12">
      <Sprite start={0} end={5} data-layer-id="background" data-layer-name="Background">
        <div
          data-layer-id="background-glow"
          style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 30% 40%, #2a1a3e 0%, #0b0b12 60%)" }}
        />
      </Sprite>

      <Sprite start={0.2} end={5} data-layer-id="kicker" data-layer-name="Kicker">
        <Kicker data-layer-id="kicker-block" />
      </Sprite>

      <Sprite start={0.5} end={5} data-layer-id="headline" data-layer-name="Headline">
        <Headline data-layer-id="headline-block" />
      </Sprite>

      <Sprite start={1.4} end={5} data-layer-id="underline" data-layer-name="Underline">
        <Underline data-layer-id="underline-block" />
      </Sprite>

      <Sprite start={1.9} end={5} data-layer-id="subtitle" data-layer-name="Subtitle">
        <Subtitle data-layer-id="subtitle-block" />
      </Sprite>
    </Stage>
  );
}
`;

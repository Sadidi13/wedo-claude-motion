/**
 * Product launch — bundled sample scene (CONTRACTS §7), stored as the raw scene.jsx
 * source so it loads through the same path as an imported Claude Motion file.
 * Written in the CONTRACTS §1 style: one <Stage>, every top-level element a
 * named <Sprite> with a stable data-layer-id, all motion a pure function of time.
 */
export const PRODUCT_LAUNCH_SOURCE = `import React from "react";
import { Zap, Shield, Sparkles } from "lucide-react";
import { Stage, Sprite, useTime, useSprite, Easing, interpolate, animate } from "./animations.jsx";

// "Nova" product launch — Motion Studio sample (1280×720, 8 s, 30 fps).
// Every top-level element is a named <Sprite>; all motion is a pure function of time.

const FONT = "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif";
const INK = "#f4f3ff";
const MUTED = "rgba(244,243,255,0.62)";
const VIOLET = "#7c6cff";
const TEAL = "#2fd4c8";

/** Glass card with a gradient icon tile. \`enter\` and \`exit\` are 0..1 progress values. */
function FeatureCard({ x, icon: Icon, title, text, enter, exit, ...rest }) {
  const p = Easing.easeOutCubic(enter);
  return (
    <div
      {...rest}
      style={{
        position: "absolute",
        left: x,
        top: 236,
        width: 340,
        boxSizing: "border-box",
        padding: "28px 28px 30px",
        borderRadius: 22,
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.10)",
        boxShadow: "0 30px 60px rgba(0,0,0,0.35)",
        fontFamily: FONT,
        color: INK,
        opacity: p * exit,
        transform: \`translateY(\${(1 - p) * 64}px)\`,
      }}
    >
      <div
        style={{
          width: 54,
          height: 54,
          borderRadius: 16,
          display: "grid",
          placeItems: "center",
          marginBottom: 20,
          background: \`linear-gradient(135deg, \${VIOLET}, \${TEAL})\`,
        }}
      >
        <Icon size={28} color="#ffffff" strokeWidth={2.2} />
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.01em", marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 16, lineHeight: 1.5, color: MUTED }}>{text}</div>
    </div>
  );
}

/** One chart column. \`grow\` is the eased 0..1 progress of the bar; the label counts up with it. */
function Bar({ x, label, value, color, grow, ...rest }) {
  const height = Math.round(grow * value * 2.6);
  return (
    <div {...rest} style={{ position: "absolute", left: x, bottom: 0, width: 96, fontFamily: FONT, color: INK, textAlign: "center" }}>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: height + 14, fontSize: 24, fontWeight: 700, opacity: grow }}>
        {Math.round(grow * value)}%
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height,
          borderRadius: "14px 14px 4px 4px",
          background: \`linear-gradient(180deg, \${color} 0%, rgba(124,108,255,0.25) 100%)\`,
        }}
      />
      <div style={{ position: "absolute", left: 0, right: 0, top: 16, fontSize: 15, letterSpacing: "0.12em", color: MUTED }}>{label}</div>
    </div>
  );
}

/** Logo circle that pops in with easeOutBack, driven by the enclosing Sprite's clock. */
function LogoMark(props) {
  const { localTime } = useSprite();
  const pop = animate({ from: 0, to: 1, start: 0, end: 0.7, ease: Easing.easeOutBack })(localTime);
  return (
    <div
      {...props}
      style={{
        position: "absolute",
        left: 580,
        top: 230,
        width: 120,
        height: 120,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        background: \`linear-gradient(135deg, \${VIOLET}, \${TEAL})\`,
        boxShadow: "0 0 90px rgba(124,108,255,0.55)",
        transform: \`scale(\${pop})\`,
      }}
    >
      <Sparkles size={56} color="#ffffff" strokeWidth={2} />
    </div>
  );
}

export default function Scene() {
  const t = useTime();
  const glowX = Math.sin(t * 0.5) * 140;
  const glowY = Math.cos(t * 0.35) * 90;
  return (
    <Stage width={1280} height={720} duration={8} fps={30} background="#0b0b12">
      <Sprite start={0} end={8} data-layer-id="sprite-bg" data-layer-name="Background">
        <div
          data-layer-id="div-bg-gradient"
          style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg, #0b0b12 0%, #141230 55%, #1c1040 100%)" }}
        />
        <div
          data-layer-id="div-bg-glow"
          style={{
            position: "absolute",
            left: 340,
            top: -140,
            width: 900,
            height: 900,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(124,108,255,0.38) 0%, rgba(124,108,255,0) 62%)",
            transform: \`translate(\${glowX}px, \${glowY}px)\`,
          }}
        />
        <div
          data-layer-id="div-bg-glow-teal"
          style={{
            position: "absolute",
            left: -260,
            top: 260,
            width: 700,
            height: 700,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(47,212,200,0.22) 0%, rgba(47,212,200,0) 62%)",
            transform: \`translate(\${-glowX * 0.6}px, \${-glowY * 0.8}px)\`,
          }}
        />
        <div
          data-layer-id="div-bg-grid"
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.35,
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
            backgroundSize: "80px 80px",
          }}
        />
      </Sprite>

      <Sprite start={0.3} end={3} data-layer-id="sprite-title" data-layer-name="Title">
        {({ localTime }) => {
          const rise = animate({ from: 0, to: 1, start: 0, end: 0.9, ease: Easing.easeOutCubic })(localTime);
          const fade = interpolate([0, 0.45, 2.25, 2.7], [0, 1, 1, 0])(localTime);
          return (
            <h1
              data-layer-id="h1-title"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 232,
                margin: 0,
                textAlign: "center",
                fontFamily: FONT,
                fontSize: 112,
                fontWeight: 800,
                lineHeight: 1,
                color: INK,
                letterSpacing: \`\${0.22 - 0.24 * rise}em\`,
                opacity: fade,
                transform: \`translateY(\${(1 - rise) * 56}px)\`,
              }}
            >
              Meet Nova
            </h1>
          );
        }}
      </Sprite>

      <Sprite start={0.9} end={3} data-layer-id="sprite-subtitle" data-layer-name="Subtitle">
        {({ localTime }) => {
          const fade = interpolate([0, 0.6, 1.65, 2.1], [0, 1, 1, 0])(localTime);
          return (
            <p
              data-layer-id="p-subtitle"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 372,
                margin: 0,
                textAlign: "center",
                fontFamily: FONT,
                fontSize: 30,
                fontWeight: 400,
                color: MUTED,
                letterSpacing: "0.01em",
                opacity: fade,
                transform: \`translateY(\${(1 - fade) * 12}px)\`,
              }}
            >
              Motion design, written as code.
            </p>
          );
        }}
      </Sprite>

      <Sprite start={3} end={5.3} data-layer-id="sprite-card-instant" data-layer-name="Card · Instant">
        {({ localTime }) => (
          <FeatureCard
            data-layer-id="card-instant"
            x={90}
            icon={Zap}
            title="Instant"
            text="Every frame renders in a millisecond. Scrub, tweak, repeat."
            enter={animate({ from: 0, to: 1, start: 0, end: 0.8, ease: Easing.linear })(localTime)}
            exit={interpolate([1.95, 2.3], [1, 0])(localTime)}
          />
        )}
      </Sprite>

      <Sprite start={3.12} end={5.3} data-layer-id="sprite-card-reliable" data-layer-name="Card · Reliable">
        {({ localTime }) => (
          <FeatureCard
            data-layer-id="card-reliable"
            x={470}
            icon={Shield}
            title="Reliable"
            text="Deterministic output: the same pixels on every machine."
            enter={animate({ from: 0, to: 1, start: 0, end: 0.8, ease: Easing.linear })(localTime)}
            exit={interpolate([1.83, 2.18], [1, 0])(localTime)}
          />
        )}
      </Sprite>

      <Sprite start={3.24} end={5.3} data-layer-id="sprite-card-beautiful" data-layer-name="Card · Beautiful">
        {({ localTime }) => (
          <FeatureCard
            data-layer-id="card-beautiful"
            x={850}
            icon={Sparkles}
            title="Beautiful"
            text="Motion curves tuned by hand, layer by layer."
            enter={animate({ from: 0, to: 1, start: 0, end: 0.8, ease: Easing.linear })(localTime)}
            exit={interpolate([1.71, 2.06], [1, 0])(localTime)}
          />
        )}
      </Sprite>

      <Sprite start={5.3} end={7} data-layer-id="sprite-chart" data-layer-name="Growth chart">
        {({ localTime }) => {
          const reveal = interpolate([0, 0.4, 1.35, 1.7], [0, 1, 1, 0])(localTime);
          const grow = (delay) =>
            animate({ from: 0, to: 1, start: 0.15 + delay, end: 1.05 + delay, ease: Easing.easeOutQuart })(localTime);
          return (
            <div
              data-layer-id="div-chart"
              style={{ position: "absolute", left: 240, top: 120, width: 800, height: 460, opacity: reveal, transform: \`translateY(\${(1 - reveal) * 24}px)\` }}
            >
              <div
                data-layer-id="div-chart-title"
                style={{ position: "absolute", left: 0, top: 0, fontFamily: FONT, fontSize: 30, fontWeight: 700, color: INK, letterSpacing: "-0.01em" }}
              >
                Scenes shipped per week
              </div>
              <div data-layer-id="div-chart-caption" style={{ position: "absolute", left: 0, top: 44, fontFamily: FONT, fontSize: 17, color: MUTED }}>
                Teams on Nova, first four sprints
              </div>
              <div data-layer-id="div-chart-plot" style={{ position: "absolute", left: 0, right: 0, top: 110, bottom: 40 }}>
                <Bar data-layer-id="bar-sprint-1" x={80} label="SPRINT 1" value={34} color={VIOLET} grow={grow(0)} />
                <Bar data-layer-id="bar-sprint-2" x={260} label="SPRINT 2" value={58} color={VIOLET} grow={grow(0.1)} />
                <Bar data-layer-id="bar-sprint-3" x={440} label="SPRINT 3" value={79} color={TEAL} grow={grow(0.2)} />
                <Bar data-layer-id="bar-sprint-4" x={620} label="SPRINT 4" value={100} color={TEAL} grow={grow(0.3)} />
                <div
                  data-layer-id="div-chart-baseline"
                  style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1, background: "rgba(255,255,255,0.18)" }}
                />
              </div>
            </div>
          );
        }}
      </Sprite>

      <Sprite start={6.8} end={8} data-layer-id="sprite-logo" data-layer-name="Logo">
        <LogoMark data-layer-id="logo-mark" />
      </Sprite>

      <Sprite start={7.05} end={8} data-layer-id="sprite-cta" data-layer-name="Call to action">
        {({ localTime }) => {
          const rise = animate({ from: 0, to: 1, start: 0, end: 0.6, ease: Easing.easeOutCubic })(localTime);
          return (
            <div
              data-layer-id="div-cta"
              style={{ position: "absolute", left: 0, right: 0, top: 392, display: "flex", justifyContent: "center", opacity: rise, transform: \`translateY(\${(1 - rise) * 28}px)\` }}
            >
              <div
                data-layer-id="div-cta-pill"
                style={{
                  padding: "16px 34px",
                  borderRadius: 999,
                  background: INK,
                  color: "#14122a",
                  fontFamily: FONT,
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                  boxShadow: "0 18px 40px rgba(0,0,0,0.35)",
                }}
              >
                Start creating · nova.app
              </div>
            </div>
          );
        }}
      </Sprite>
    </Stage>
  );
}
`;

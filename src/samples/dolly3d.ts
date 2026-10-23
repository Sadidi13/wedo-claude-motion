/**
 * 3D dolly — bundled sample scene (CONTRACTS §7), stored as the raw scene.jsx
 * source so it loads through the same path as an imported Claude Motion file.
 * Shows the 3D contract (CONTRACTS §1 "3D scenes"): the three.js world is ONE
 * <Three3D> layer whose `setup` builds it once and whose `render` poses it
 * from the time alone; the title, subtitle and vignette are ordinary 2D
 * Sprites composited above it.
 */
export const DOLLY_3D_SOURCE = `import React from "react";
import * as THREE from "three";
import { Stage, Sprite, Three3D, Easing, interpolate } from "./animations.jsx";

// 3D dolly — Motion Studio sample (1080×1920, 6 s, 30 fps).
// The camera glides down a corridor of lit boxes towards a glowing sign, then a title lands.

const FONT = "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif";
const ACCENT = "#ff5a36";
const NIGHT = "#07080d";

const dolly = interpolate([0, 5.4], [16, 3], Easing.easeInOutCubic);
const rise = interpolate([0, 5.4], [0.1, 1.2], Easing.easeInOutCubic);

/** Runs once: lights, floor, boxes and the sign. Returns what render() animates. */
function buildWorld({ scene, renderer }) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  scene.background = new THREE.Color(NIGHT);
  scene.fog = new THREE.Fog(NIGHT, 6, 30);

  scene.add(new THREE.HemisphereLight("#bcd4ff", "#10131c", 1.4));
  const key = new THREE.DirectionalLight("#ffffff", 3.2);
  key.position.set(4, 8, 6);
  scene.add(key);
  const glow = new THREE.PointLight(ACCENT, 40, 0, 2);
  glow.position.set(0, 2.4, -12);
  scene.add(glow);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 80),
    new THREE.MeshStandardMaterial({ color: "#0d1018", roughness: 0.55, metalness: 0.35 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.2;
  scene.add(floor);

  const cube = new THREE.BoxGeometry(1, 1, 1);
  const slate = new THREE.MeshStandardMaterial({ color: "#2b3350", roughness: 0.4, metalness: 0.15 });
  const ember = new THREE.MeshStandardMaterial({ color: ACCENT, roughness: 0.35, emissive: ACCENT, emissiveIntensity: 0.3 });
  const boxes = Array.from({ length: 18 }, (_, i) => {
    const size = 0.7 + THREE.MathUtils.seededRandom(i + 1) * 0.9;
    const mesh = new THREE.Mesh(cube, i % 5 === 2 ? ember : slate);
    mesh.scale.setScalar(size);
    mesh.position.set(
      (i % 2 === 0 ? -1 : 1) * (1.8 + THREE.MathUtils.seededRandom(i + 40)),
      -1.2 + size / 2 + (i % 3 === 0 ? 1.1 : 0),
      6 - i * 1.6,
    );
    scene.add(mesh);
    return { mesh, spin: 0.2 + THREE.MathUtils.seededRandom(i + 80) * 0.5, phase: i };
  });

  // The sign: text drawn once on an offscreen canvas and used as a texture.
  const canvas = new OffscreenCanvas(1024, 256);
  const ink = canvas.getContext("2d");
  ink.fillStyle = "#000";
  ink.fillRect(0, 0, 1024, 256);
  ink.font = \`800 150px \${FONT}\`;
  ink.textAlign = "center";
  ink.textBaseline = "middle";
  ink.fillStyle = ACCENT;
  ink.fillText("MOTION", 512, 136);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(4.4, 1.1),
    // fog: false keeps the black canvas background invisible under additive blending
    new THREE.MeshBasicMaterial({ map: texture, blending: THREE.AdditiveBlending, transparent: true, fog: false, toneMapped: false }),
  );
  sign.position.set(0, 2.4, -14);
  scene.add(sign);

  return { boxes, sign };
}

/** Every frame: pose the camera, boxes and sign from the stage time (absolute values only). */
function poseWorld(t, { camera, state }) {
  camera.position.set(Math.sin(t * 0.6) * 0.35, rise(t), dolly(t));
  camera.lookAt(0, 0.8, dolly(t) - 14);
  for (const { mesh, spin, phase } of state.boxes) {
    mesh.rotation.set(t * spin + phase, t * spin * 1.3 + phase * 0.5, 0);
  }
  state.sign.material.opacity = 0.85 + 0.15 * Math.sin(t * 9);
}

export default function Scene() {
  return (
    <Stage width={1080} height={1920} duration={6} fps={30} background="#07080d">
      <Sprite start={0} end={6} data-layer-id="world" data-layer-name="3D world">
        <Three3D data-layer-id="corridor" data-layer-name="Corridor" camera={{ fov: 50 }} setup={buildWorld} render={poseWorld} />
      </Sprite>

      <Sprite start={0} end={6} data-layer-id="vignette" data-layer-name="Vignette">
        <div
          data-layer-id="vignette-fill"
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(ellipse at 50% 45%, rgba(7,8,13,0) 45%, rgba(7,8,13,0.85) 100%)",
          }}
        />
      </Sprite>

      <Sprite start={0.3} end={6} data-layer-id="kicker" data-layer-name="Kicker">
        {({ localTime }) => {
          const p = Easing.easeOutCubic(Math.min(localTime / 0.6, 1));
          return (
            <p
              data-layer-id="kicker-text"
              style={{
                position: "absolute",
                left: 94,
                top: 150,
                margin: 0,
                color: "rgba(255,255,255,0.72)",
                font: \`700 30px/1 \${FONT}\`,
                letterSpacing: 6,
                opacity: p,
              }}
            >
              NEW · 3D LAYERS
            </p>
          );
        }}
      </Sprite>

      <Sprite start={3.6} end={6} data-layer-id="title" data-layer-name="Title">
        {({ localTime }) => {
          const p = Easing.easeOutCubic(Math.min(localTime / 0.7, 1));
          return (
            <h1
              data-layer-id="title-text"
              style={{
                position: "absolute",
                left: 90,
                right: 90,
                bottom: 420,
                margin: 0,
                color: "#ffffff",
                font: \`800 128px/1 \${FONT}\`,
                letterSpacing: -2,
                opacity: p,
                transform: \`translateY(\${(1 - p) * 70}px)\`,
              }}
            >
              Into the depth
            </h1>
          );
        }}
      </Sprite>

      <Sprite start={4} end={6} data-layer-id="subtitle" data-layer-name="Subtitle">
        {({ localTime }) => {
          const p = Easing.easeOutCubic(Math.min(localTime / 0.6, 1));
          return (
            <p
              data-layer-id="subtitle-text"
              style={{
                position: "absolute",
                left: 94,
                right: 90,
                bottom: 340,
                margin: 0,
                color: ACCENT,
                font: \`600 44px/1.2 \${FONT}\`,
                opacity: p,
                transform: \`translateY(\${(1 - p) * 30}px)\`,
              }}
            >
              Real 3D, still a pure function of time
            </p>
          );
        }}
      </Sprite>
    </Stage>
  );
}
`;

/**
 * 3D product — bundled sample scene (CONTRACTS §7) with a glTF model. The
 * project carries `assets/bottle.glb` (built in code by
 * scripts/make-sample-model.mjs); `<Three3D models>` parses it before the
 * first frame and `setup` receives it ready to add to the scene;
 * `environment` gives its gold and glass studio reflections. A ring of
 * over-bright colour under the bottle glows through `bloom`; the backdrop and
 * the copy are ordinary 2D layers, the canvas stays transparent between them.
 */
export const PRODUCT_3D_MODEL_PATH = "assets/bottle.glb";

export const PRODUCT_3D_SOURCE = `import React from "react";
import * as THREE from "three";
import { Stage, Sprite, Three3D, Easing, interpolate } from "./animations.jsx";

// 3D product — Motion Studio sample (1080×1920, 6 s, 30 fps).
// A serum bottle (assets/bottle.glb) turns into view on a glowing ring, then the copy lands.

const FONT = "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif";
const ACCENT = "#3fe0c5";

const turn = interpolate([0, 6], [-2.4, 0.5], Easing.easeOutCubic);
const push = interpolate([0, 6], [7.6, 6.1], Easing.easeInOutCubic);
const lift = interpolate([0, 1.4], [-0.6, 0], Easing.easeOutCubic);

/** Runs once: lights, the bottle from the glTF file and the glow ring (reflections come from \`environment\`). */
function buildProduct({ scene, renderer, models }) {
  renderer.toneMapping = THREE.NeutralToneMapping; // keeps the product's own colours
  const key = new THREE.DirectionalLight("#ffffff", 1.6);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(ACCENT, 1.8);
  rim.position.set(-4, 2.5, -3);
  scene.add(rim);

  const bottle = models.bottle.scene;
  const product = new THREE.Group();
  product.add(bottle);
  scene.add(product);

  // Colour above 1.0 is brighter than the bloom threshold, so only the ring glows.
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.85, 0.025, 16, 96),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(ACCENT).multiplyScalar(5), toneMapped: false }),
  );
  ring.rotation.x = Math.PI / 2;
  scene.add(ring);

  return { product, ring };
}

/** Every frame: turn the bottle, push the camera in, breathe the ring (absolute values only). */
function poseProduct(t, { camera, state }) {
  state.product.rotation.y = turn(t);
  state.product.position.y = lift(t);
  state.ring.scale.setScalar(1 + 0.04 * Math.sin(t * 2.4));
  camera.position.set(0, 1.6, push(t));
  camera.lookAt(0, 0.95, 0);
}

export default function Scene() {
  return (
    <Stage width={1080} height={1920} duration={6} fps={30} background="#0a0d12">
      <Sprite start={0} end={6} data-layer-id="backdrop" data-layer-name="Backdrop">
        <div
          data-layer-id="backdrop-glow"
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(ellipse 70% 45% at 50% 52%, #17323a 0%, #0f1a22 45%, #0a0d12 100%)",
          }}
        />
      </Sprite>

      <Sprite start={0} end={6} data-layer-id="product" data-layer-name="Product">
        <Three3D
          data-layer-id="bottle"
          data-layer-name="Bottle"
          models={{ bottle: "assets/bottle.glb" }}
          environment
          bloom={{ strength: 0.7, radius: 0.5, threshold: 2 }}
          camera={{ fov: 32 }}
          setup={buildProduct}
          render={poseProduct}
        />
      </Sprite>

      <Sprite start={0.6} end={6} data-layer-id="kicker" data-layer-name="Kicker">
        {({ localTime }) => {
          const p = Easing.easeOutCubic(Math.min(localTime / 0.6, 1));
          return (
            <p
              data-layer-id="kicker-text"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 190,
                margin: 0,
                textAlign: "center",
                color: ACCENT,
                font: \`700 30px/1 \${FONT}\`,
                letterSpacing: 8,
                opacity: p,
              }}
            >
              NEW · SERUM 01
            </p>
          );
        }}
      </Sprite>

      <Sprite start={1.2} end={6} data-layer-id="title" data-layer-name="Title">
        {({ localTime }) => {
          const p = Easing.easeOutCubic(Math.min(localTime / 0.8, 1));
          return (
            <h1
              data-layer-id="title-text"
              style={{
                position: "absolute",
                left: 60,
                right: 60,
                top: 250,
                margin: 0,
                textAlign: "center",
                color: "#ffffff",
                font: \`800 120px/1.05 \${FONT}\`,
                letterSpacing: -2,
                opacity: p,
                transform: \`translateY(\${(1 - p) * 50}px)\`,
              }}
            >
              Glow, bottled.
            </h1>
          );
        }}
      </Sprite>

      <Sprite start={3.6} end={6} data-layer-id="cta" data-layer-name="Call to action">
        {({ localTime }) => {
          const p = Easing.easeOutBack(Math.min(localTime / 0.6, 1));
          return (
            <div
              data-layer-id="cta-pill"
              style={{
                position: "absolute",
                left: "50%",
                bottom: 260,
                padding: "26px 56px",
                borderRadius: 999,
                background: "#ffffff",
                color: "#0a0d12",
                font: \`700 40px/1 \${FONT}\`,
                transform: \`translateX(-50%) scale(\${p})\`,
              }}
            >
              Available now
            </div>
          );
        }}
      </Sprite>
    </Stage>
  );
}
`;

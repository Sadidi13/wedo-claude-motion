"use client";
/**
 * <Three3D> — a three.js scene as ONE layer, drawn as a pure function of time
 * (CONTRACTS.md §1 "3D scenes"). Exported from the runtime (`./animations.jsx`).
 *
 *   <Three3D setup={(ctx) => state} render={(t, frame) => { … }} data-layer-id="…" />
 *
 * Lifecycle — no requestAnimationFrame loop, no clock, no timers:
 *   mount     a <canvas> with a WebGLRenderer (alpha, and preserveDrawingBuffer
 *             so a headless screenshot always sees the last drawn frame), an
 *             empty Scene and a PerspectiveCamera sized to the layer;
 *   wait      web fonts (`document.fonts.ready`: text drawn into a texture in
 *             setup is baked once), the optional `textures` images and the
 *             optional `models` glTF files (`{ name: url }`, project assets
 *             become data URLs) are ready before anything is drawn; the frame
 *             is held (pending.ts) so the exporter waits too;
 *   setup     runs once per mount with { THREE, scene, camera, renderer,
 *             width, height, textures, models }: build meshes, lights,
 *             materials (with `environment`, studio reflections are already
 *             on `scene.environment`). Whatever it returns comes back to
 *             `render` as `frame.state`;
 *   commit    every render of the component (each time change) calls
 *             `render(t, frame)` and then draws the scene, through a bloom
 *             pass when `bloom` is set (skip with autoRender={false}). It runs
 *             in a layout effect, so under `window.__seek` (flushSync) the
 *             canvas is drawn before the call returns;
 *   unmount   geometries, materials, textures, models, the bloom passes and
 *             the renderer are disposed and the WebGL context is released
 *             (browsers allow only ~16).
 *
 * Scenes may only import the main `three` module; the glTF loader,
 * RoomEnvironment and the bloom passes come from `three/addons` here, inside
 * the runtime.
 *
 * The wrapper <div> carries the `data-*` props, so the canvas is one layer for
 * selection and `__getLayerRects`. Errors (WebGL missing, lost context, a
 * throwing setup/render) surface through the Stage's error boundary.
 */

import React, { useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes } from "react";
import { flushSync } from "react-dom";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { fontsLoaded } from "./fonts";
import { useSprite, useStage, useTime } from "./motion";
import { holdFrame } from "./pending";

/** One parsed glTF / GLB file from the `models` prop. */
export interface Three3DModel {
  /** the file's default scene: add it (or its children) to your scene */
  scene: THREE.Group;
  /** animation clips; play one with an AnimationMixer and `mixer.setTime(t)` */
  animations: THREE.AnimationClip[];
  cameras: THREE.Camera[];
}

export interface Three3DContext {
  /** the three.js module (same instance as `import * as THREE from "three"`) */
  THREE: typeof THREE;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** layer size in CSS px; the canvas has `width × pixelRatio` device pixels */
  width: number;
  height: number;
  /** the decoded `textures` prop (same keys) */
  textures: Record<string, THREE.Texture>;
  /** the parsed `models` prop (same keys) */
  models: Record<string, Three3DModel>;
}

export interface Three3DFrame<S = unknown> extends Three3DContext {
  /** what `setup` returned */
  state: S;
  /** stage time in seconds (same as the first argument of `render`) */
  time: number;
  /** time / progress of the enclosing Sprite (the whole stage outside a Sprite) */
  localTime: number;
  progress: number;
}

export interface Three3DCameraOptions {
  fov?: number;
  near?: number;
  far?: number;
}

/**
 * UnrealBloomPass settings: glow around pixels brighter than `threshold`. The
 * scene is measured before tone mapping, so with the default threshold of 1
 * only over-bright colour glows (e.g. `color.multiplyScalar(4)` with
 * `toneMapped: false`, or a strong emissive), not ordinary lit surfaces.
 */
export interface Three3DBloomOptions {
  /** default 0.8 */
  strength?: number;
  /** spread, 0 to 1; default 0.4 */
  radius?: number;
  /** linear luminance above which pixels glow; default 1 */
  threshold?: number;
}

export interface Three3DProps<S = unknown> extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** build the scene once per mount; the return value is passed back as `frame.state` */
  setup?: (ctx: Three3DContext) => S;
  /** set every time-dependent property from `time` (absolute values, never increments) */
  render?: (time: number, frame: Three3DFrame<S>) => void;
  /** layer size in CSS px (default: the Stage size) */
  width?: number;
  height?: number;
  /** initial PerspectiveCamera (default fov 45, near 0.1, far 1000) */
  camera?: Three3DCameraOptions;
  /** images to decode before the first frame: `{ logo: "assets/logo.png" }` */
  textures?: Record<string, string>;
  /** glTF files (.glb, or .gltf with embedded data) to parse before the first frame: `{ product: "assets/product.glb" }` */
  models?: Record<string, string>;
  /** glow on bright pixels (`true` for the defaults); drawn by the automatic render only */
  bloom?: boolean | Three3DBloomOptions;
  /**
   * studio reflections (`scene.environment`, set before `setup`): `true`, or its intensity.
   * Metallic and glossy glTF materials look dark and flat without one.
   */
  environment?: boolean | number;
  antialias?: boolean;
  /** false: `render` draws itself (e.g. several passes); default true */
  autoRender?: boolean;
  [dataAttribute: `data-${string}`]: string | number | boolean | undefined;
}

const MAX_PIXEL_RATIO = 2;

function pixelRatio(): number {
  return Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_PIXEL_RATIO);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function disposeMaterial(material: THREE.Material): void {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
  material.dispose();
}

/** Free the geometries, materials and material textures under `root`. */
function disposeTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    const { geometry, material } = object as Partial<THREE.Mesh>;
    geometry?.dispose();
    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else if (material) disposeMaterial(material);
  });
}

/** Free the GPU resources of everything reachable from the scene. */
function disposeScene(scene: THREE.Scene): void {
  disposeTree(scene);
  if (scene.background instanceof THREE.Texture) scene.background.dispose();
  scene.environment?.dispose();
}

/**
 * Fetches (a data: URL in projects, so no network) and parses one glTF file. Meshopt
 * compression and quantised attributes decode here; Draco and KTX2 need decoder files the
 * export renderer is not allowed to fetch, so they fail with a hint instead.
 */
async function loadModel(name: string, url: string): Promise<Three3DModel> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.parseAsync(await response.arrayBuffer(), "");
    return { scene: gltf.scene, animations: gltf.animations, cameras: gltf.cameras };
  } catch (error) {
    const hint = /draco|ktx2|basisu/i.test(describe(error))
      ? " Draco and KTX2 compression are not supported: re-export with meshopt (gltf-transform optimize --compress meshopt --texture-compress webp)."
      : "";
    throw new Error(`Three3D could not load model "${name}" (${describe(error)}).${hint}`, { cause: error });
  }
}

/** A blurred studio room (three's RoomEnvironment) as the scene's reflection map. */
function addStudioEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene, intensity: number): void {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  scene.environmentIntensity = intensity;
  room.dispose();
  pmrem.dispose();
}

function bloomSettings(bloom: Three3DProps["bloom"]): Required<Three3DBloomOptions> | null {
  if (!bloom) return null;
  const options = bloom === true ? {} : bloom;
  return { strength: options.strength ?? 0.8, radius: options.radius ?? 0.4, threshold: options.threshold ?? 1 };
}

function loadTexture(name: string, url: string): Promise<THREE.Texture> {
  const image = new Image();
  // Only matters for http(s) URLs: without CORS the texture upload would fail later, less clearly.
  image.crossOrigin = "anonymous";
  image.src = url;
  return image.decode().then(
    () => {
      const texture = new THREE.Texture(image);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      return texture;
    },
    () => {
      throw new Error(`Three3D could not load texture "${name}"`);
    },
  );
}

interface Bloom {
  composer: EffectComposer;
  pass: UnrealBloomPass;
}

interface Engine {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** size the renderer was last set to (0 before the first frame) */
  width: number;
  height: number;
  pixelRatio: number;
  setupDone: boolean;
  state: unknown;
  /** created on the first frame that asks for bloom, dropped when it is turned off */
  bloom: Bloom | null;
}

/** What setup waits for: fonts, plus the decoded `textures` and parsed `models`. */
interface Loaded {
  textures: Record<string, THREE.Texture>;
  models: Record<string, Three3DModel>;
}

/** A short stand-in for a (possibly multi-megabyte) data URL in the remount key. */
function urlKey(url: string): string {
  return url.length > 256 ? `${url.length}:${url.slice(0, 96)}…${url.slice(-96)}` : url;
}

function assetsKey(urls: Record<string, string> | undefined): string {
  return Object.entries(urls ?? {})
    .map(([name, url]) => `${name}=${urlKey(url)}`)
    .join("|");
}

function disposeBloom(bloom: Bloom): void {
  bloom.pass.dispose();
  bloom.composer.dispose();
}

/**
 * Remounts the canvas when `textures`, `models`, `environment` or `antialias`
 * change, so `setup` always runs exactly once against a fresh scene.
 */
export function Three3D<S = unknown>(props: Three3DProps<S>) {
  const key = `${props.antialias !== false}|${String(props.environment ?? false)}|${assetsKey(props.textures)}|${assetsKey(props.models)}`;
  return <Three3DCanvas<S> key={key} {...props} />;
}

function Three3DCanvas<S>({
  setup,
  render,
  width: widthProp,
  height: heightProp,
  camera: cameraOptions,
  textures: textureUrls,
  models: modelUrls,
  bloom,
  environment,
  antialias = true,
  autoRender = true,
  style,
  ...rest
}: Three3DProps<S>) {
  const time = useTime();
  const { localTime, progress } = useSprite();
  const stage = useStage();
  const width = widthProp ?? stage.width;
  const height = heightProp ?? stage.height;

  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);
  // null until setup may run: fonts loaded (text drawn into a texture is baked once), textures
  // decoded and models parsed.
  const [loaded, setLoaded] = useState<Loaded | null>(() =>
    Object.keys(textureUrls ?? {}).length || Object.keys(modelUrls ?? {}).length || !fontsLoaded()
      ? null
      : { textures: {}, models: {} },
  );

  // Mount: canvas + renderer + scene + camera. The canvas is created here (not in JSX) so a
  // remount never reuses a canvas whose context was already released.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "display:block;width:100%;height:100%";
    host.appendChild(canvas);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias,
        alpha: true,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance",
      });
    } catch (error) {
      canvas.remove();
      // Thrown from the effect, it reaches the Stage's error boundary like a render error.
      throw new Error(`Three3D: WebGL is not available in this browser (${describe(error)})`, { cause: error });
    }
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      cameraOptions?.fov ?? 45,
      width / height,
      cameraOptions?.near ?? 0.1,
      cameraOptions?.far ?? 1000,
    );
    const engine: Engine = { renderer, scene, camera, width: 0, height: 0, pixelRatio: 0, setupDone: false, state: undefined, bloom: null };
    engineRef.current = engine;

    // A lost context would otherwise export silently blank frames.
    const onContextLost = () =>
      setFailure(new Error("Three3D: the WebGL context was lost (GPU reset, or too many 3D layers at once)"));
    canvas.addEventListener("webglcontextlost", onContextLost);
    return () => {
      canvas.removeEventListener("webglcontextlost", onContextLost);
      engineRef.current = null;
      if (engine.bloom) disposeBloom(engine.bloom);
      disposeScene(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
    // Size and camera changes are applied per frame; everything else remounts via the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fonts + textures + models: wait once, holding the frame until the first draw that uses them.
  useLayoutEffect(() => {
    if (loaded) return;
    const textureEntries = Object.entries(textureUrls ?? {});
    const modelEntries = Object.entries(modelUrls ?? {});
    const release = holdFrame();
    let cancelled = false;
    let textureList: THREE.Texture[] = [];
    let modelList: Three3DModel[] = [];
    const disposeAll = () => {
      for (const texture of textureList) texture.dispose();
      for (const model of modelList) disposeTree(model.scene);
    };
    const fonts = document.fonts?.ready ?? Promise.resolve();
    Promise.all([
      fonts,
      Promise.all(textureEntries.map(([name, url]) => loadTexture(name, url))),
      Promise.all(modelEntries.map(([name, url]) => loadModel(name, url))),
    ]).then(
      ([, textures, models]) => {
        textureList = textures;
        modelList = models;
        if (cancelled) {
          disposeAll();
          return;
        }
        // flushSync: the frame effect has drawn with the textures and models before the hold is released.
        try {
          flushSync(() =>
            setLoaded({
              textures: Object.fromEntries(textureEntries.map(([name], i) => [name, textures[i]])),
              models: Object.fromEntries(modelEntries.map(([name], i) => [name, models[i]])),
            }),
          );
        } finally {
          release();
        }
      },
      (error: unknown) => {
        try {
          if (!cancelled) flushSync(() => setFailure(error instanceof Error ? error : new Error(String(error))));
        } finally {
          release();
        }
      },
    );
    return () => {
      cancelled = true;
      disposeAll();
      release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Frame: runs after every commit (each time change), so the picture is a function of `time`.
  useLayoutEffect(() => {
    const engine = engineRef.current;
    if (!engine || !loaded) return;
    const { renderer, scene, camera } = engine;
    const ratio = pixelRatio();
    const glow = bloomSettings(bloom);
    if (glow && !engine.bloom) {
      const composer = new EffectComposer(renderer);
      const pass = new UnrealBloomPass(new THREE.Vector2(width, height), glow.strength, glow.radius, glow.threshold);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(pass);
      composer.addPass(new OutputPass());
      engine.bloom = { composer, pass };
      engine.width = 0; // size the new composer below
    } else if (!glow && engine.bloom) {
      disposeBloom(engine.bloom);
      engine.bloom = null;
    }
    if (engine.width !== width || engine.height !== height || engine.pixelRatio !== ratio) {
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      engine.bloom?.composer.setPixelRatio(ratio);
      engine.bloom?.composer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      engine.width = width;
      engine.height = height;
      engine.pixelRatio = ratio;
    }
    if (glow && engine.bloom) {
      engine.bloom.pass.strength = glow.strength;
      engine.bloom.pass.radius = glow.radius;
      engine.bloom.pass.threshold = glow.threshold;
    }
    const ctx: Three3DContext = { THREE, scene, camera, renderer, width, height, textures: loaded.textures, models: loaded.models };
    if (!engine.setupDone) {
      engine.setupDone = true;
      if (environment) addStudioEnvironment(renderer, scene, environment === true ? 1 : environment);
      engine.state = setup?.(ctx);
    }
    render?.(time, { ...ctx, state: engine.state as S, time, localTime, progress });
    if (!autoRender) return;
    if (engine.bloom) {
      // WebGL starts with clear alpha 1 and the renderer only pushes its own (0: transparent)
      // inside renderer.render, after RenderPass has cleared: without this the layer turns opaque.
      renderer.setClearAlpha(renderer.getClearAlpha());
      // 0: no frame delta, so the composer never reads its own clock.
      engine.bloom.composer.render(0);
    } else {
      renderer.render(scene, camera);
    }
  });

  if (failure) throw failure;
  const wrapperStyle: CSSProperties = { position: "absolute", left: 0, top: 0, width, height, ...style };
  return <div data-three3d="" {...rest} ref={hostRef} style={wrapperStyle} />;
}

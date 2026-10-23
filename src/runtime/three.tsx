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
 *             setup is baked once) and the optional `textures` images
 *             (`{ name: url }`, project assets become data URLs) are ready
 *             before anything is drawn; the frame is held (pending.ts) so the
 *             exporter waits too;
 *   setup     runs once per mount with { THREE, scene, camera, renderer,
 *             width, height, textures }: build meshes, lights, materials.
 *             Whatever it returns comes back to `render` as `frame.state`;
 *   commit    every render of the component (each time change) calls
 *             `render(t, frame)` and then `renderer.render(scene, camera)`
 *             (skip with autoRender={false}). It runs in a layout effect, so
 *             under `window.__seek` (flushSync) the canvas is drawn before the
 *             call returns;
 *   unmount   geometries, materials, textures and the renderer are disposed
 *             and the WebGL context is released (browsers allow only ~16).
 *
 * The wrapper <div> carries the `data-*` props, so the canvas is one layer for
 * selection and `__getLayerRects`. Errors (WebGL missing, lost context, a
 * throwing setup/render) surface through the Stage's error boundary.
 */

import React, { useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes } from "react";
import { flushSync } from "react-dom";
import * as THREE from "three";
import { fontsLoaded } from "./fonts";
import { useSprite, useStage, useTime } from "./motion";
import { holdFrame } from "./pending";

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

/** Free the GPU resources of everything reachable from the scene. */
function disposeScene(scene: THREE.Scene): void {
  scene.traverse((object) => {
    const { geometry, material } = object as Partial<THREE.Mesh>;
    geometry?.dispose();
    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else if (material) disposeMaterial(material);
  });
  if (scene.background instanceof THREE.Texture) scene.background.dispose();
  scene.environment?.dispose();
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
}

/**
 * Remounts the canvas when `textures` or `antialias` change, so `setup` always
 * runs exactly once against a fresh scene.
 */
export function Three3D<S = unknown>(props: Three3DProps<S>) {
  const textureKey = Object.entries(props.textures ?? {})
    .map(([name, url]) => `${name}=${url}`)
    .join("|");
  return <Three3DCanvas<S> key={`${props.antialias !== false}|${textureKey}`} {...props} />;
}

function Three3DCanvas<S>({
  setup,
  render,
  width: widthProp,
  height: heightProp,
  camera: cameraOptions,
  textures: textureUrls,
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
  // null until setup may run: fonts loaded (text drawn into a texture is baked once) and textures decoded.
  const [textures, setTextures] = useState<Record<string, THREE.Texture> | null>(() =>
    Object.keys(textureUrls ?? {}).length || !fontsLoaded() ? null : {},
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
    engineRef.current = { renderer, scene, camera, width: 0, height: 0, pixelRatio: 0, setupDone: false, state: undefined };

    // A lost context would otherwise export silently blank frames.
    const onContextLost = () =>
      setFailure(new Error("Three3D: the WebGL context was lost (GPU reset, or too many 3D layers at once)"));
    canvas.addEventListener("webglcontextlost", onContextLost);
    return () => {
      canvas.removeEventListener("webglcontextlost", onContextLost);
      engineRef.current = null;
      disposeScene(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
    // Size and camera changes are applied per frame; everything else remounts via the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fonts + textures: wait once, holding the frame until the first draw that uses them.
  useLayoutEffect(() => {
    if (textures) return;
    const entries = Object.entries(textureUrls ?? {});
    const release = holdFrame();
    let cancelled = false;
    let loaded: THREE.Texture[] = [];
    const fonts = document.fonts?.ready ?? Promise.resolve();
    Promise.all([fonts, Promise.all(entries.map(([name, url]) => loadTexture(name, url)))]).then(
      ([, list]) => {
        loaded = list;
        if (cancelled) {
          for (const texture of list) texture.dispose();
          return;
        }
        // flushSync: the frame effect has drawn with the textures before the hold is released.
        try {
          flushSync(() => setTextures(Object.fromEntries(entries.map(([name], i) => [name, list[i]]))));
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
      for (const texture of loaded) texture.dispose();
      release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Frame: runs after every commit (each time change), so the picture is a function of `time`.
  useLayoutEffect(() => {
    const engine = engineRef.current;
    if (!engine || !textures) return;
    const { renderer, scene, camera } = engine;
    const ratio = pixelRatio();
    if (engine.width !== width || engine.height !== height || engine.pixelRatio !== ratio) {
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      engine.width = width;
      engine.height = height;
      engine.pixelRatio = ratio;
    }
    const ctx: Three3DContext = { THREE, scene, camera, renderer, width, height, textures };
    if (!engine.setupDone) {
      engine.setupDone = true;
      engine.state = setup?.(ctx);
    }
    render?.(time, { ...ctx, state: engine.state as S, time, localTime, progress });
    if (autoRender) renderer.render(scene, camera);
  });

  if (failure) throw failure;
  const wrapperStyle: CSSProperties = { position: "absolute", left: 0, top: 0, width, height, ...style };
  return <div data-three3d="" {...rest} ref={hostRef} style={wrapperStyle} />;
}

/**
 * Bundled demo projects (CONTRACTS §7). Each sample is a scene.jsx source
 * string turned into a Project at module load; the parse doubles as a
 * self-check (a broken sample throws at import time rather than in the UI).
 * The product-launch scene is also the reference the AI prompt links to.
 */
import { ensureLayerIds, parseScene } from "@/lib/parser";
import type { Project, ProjectFile } from "@/lib/types";
import { DOLLY_3D_SOURCE } from "./dolly3d";
import { KINETIC_TYPE_SOURCE } from "./kineticType";
import { LOWER_THIRD_SOURCE } from "./lowerThird";
import { PRODUCT_3D_MODEL_PATH, PRODUCT_3D_SOURCE } from "./product3d";
import { PRODUCT_LAUNCH_SOURCE } from "./productLaunch";
import { PRODUCT_MODEL_GLB } from "./productModel";

export interface Sample {
  id: string;
  name: string;
  description: string;
  project: Project;
}

/** Fixed so a sample's Project is identical on every load (ids and dates are not random). */
const SAMPLE_DATE = "2026-10-01T00:00:00.000Z";

/** `assets`: project path → data URL, for samples that ship a file (e.g. a glTF model). */
function sampleProject(id: string, name: string, source: string, assets: Record<string, string> = {}): Project {
  const { source: entry } = ensureLayerIds(source);
  const scene = parseScene(entry);
  const assetFiles = Object.fromEntries(
    Object.entries(assets).map(([path, content]): [string, ProjectFile] => [path, { path, kind: "asset", content }]),
  );
  return {
    id: `sample-${id}`,
    name,
    entry: "scene.jsx",
    files: { "scene.jsx": { path: "scene.jsx", kind: "jsx", content: entry }, ...assetFiles },
    meta: scene.meta,
    createdAt: SAMPLE_DATE,
    updatedAt: SAMPLE_DATE,
    origin: "sample",
  };
}

export const samples: Sample[] = [
  {
    id: "product-launch",
    name: "Product launch",
    description:
      "1280×720, 8 s. Drifting gradient glow, rising title, three staggered feature cards with lucide icons, a growing bar chart with counting labels, logo and CTA outro.",
    project: sampleProject("product-launch", "Product launch", PRODUCT_LAUNCH_SOURCE),
  },
  {
    id: "lower-third",
    name: "Lower third",
    description:
      "1920×1080, 5 s. A name / title plate that slides in, holds and slides out — export it with alpha to overlay on footage.",
    project: sampleProject("lower-third", "Lower third", LOWER_THIRD_SOURCE),
  },
  {
    id: "dolly-3d",
    name: "3D dolly",
    description:
      "1080×1920, 6 s. A three.js layer: the camera glides down a corridor of lit boxes towards a glowing sign, then a title lands.",
    project: sampleProject("dolly-3d", "3D dolly", DOLLY_3D_SOURCE),
  },
  {
    id: "kinetic-type",
    name: "Kinetic type (GSAP)",
    description:
      "1080×1920, 5 s. GSAP timelines driven by the playhead: a typed kicker, a SplitText headline rising letter by letter, a drawn SVG stroke and a word-by-word subtitle.",
    project: sampleProject("kinetic-type", "Kinetic type", KINETIC_TYPE_SOURCE),
  },
  {
    id: "product-3d",
    name: "3D product (glTF)",
    description:
      "1080×1920, 6 s. A glTF model (assets/bottle.glb) loaded with <Three3D models>: a serum bottle turns into view on a ring that glows through bloom, then the copy lands.",
    project: sampleProject("product-3d", "3D product", PRODUCT_3D_SOURCE, { [PRODUCT_3D_MODEL_PATH]: PRODUCT_MODEL_GLB }),
  },
];

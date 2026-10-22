/**
 * Bundled demo projects (CONTRACTS §7). Each sample is a scene.jsx source
 * string turned into a Project at module load; the parse doubles as a
 * self-check (a broken sample throws at import time rather than in the UI).
 * The product-launch scene is also the reference the AI prompt links to.
 */
import { ensureLayerIds, parseScene } from "@/lib/parser";
import type { Project } from "@/lib/types";
import { LOWER_THIRD_SOURCE } from "./lowerThird";
import { PRODUCT_LAUNCH_SOURCE } from "./productLaunch";

export interface Sample {
  id: string;
  name: string;
  description: string;
  project: Project;
}

/** Fixed so a sample's Project is identical on every load (ids and dates are not random). */
const SAMPLE_DATE = "2026-10-01T00:00:00.000Z";

function sampleProject(id: string, name: string, source: string): Project {
  const { source: entry } = ensureLayerIds(source);
  const scene = parseScene(entry);
  return {
    id: `sample-${id}`,
    name,
    entry: "scene.jsx",
    files: { "scene.jsx": { path: "scene.jsx", kind: "jsx", content: entry } },
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
];

/**
 * createBlankProject — an empty 1920×1080, 10 s, 30 fps scene with one
 * centred "Your title" Sprite, written in the CONTRACTS §1 style with layer
 * ids already in place (CONTRACTS §7).
 */
import type { Project, StageMeta } from "@/lib/types";
import { DEFAULT_IMPORT_META, resolveMeta, stageMetaProps } from "./meta";
import { buildProject } from "./project";

const BLANK_META: StageMeta = { ...DEFAULT_IMPORT_META, background: "#0b0b12" };

function blankSource(meta: StageMeta): string {
  return `import React from "react";
import { Stage, Sprite, useTime, useSprite, Easing, interpolate, animate } from "./animations.jsx";

export default function Scene() {
  return (
    <Stage ${stageMetaProps(meta)}>
      <Sprite start={0} end={${meta.duration}} data-layer-id="sprite-title" data-layer-name="Title">
        {({ localTime }) => {
          const reveal = animate({ from: 0, to: 1, start: 0, end: 0.8, ease: Easing.easeOutCubic })(localTime);
          return (
            <div data-layer-id="div-title-center" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <h1
                data-layer-id="h1-title"
                style={{
                  margin: 0,
                  fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
                  fontSize: ${Math.round(meta.height * 0.09)},
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: "#ffffff",
                  opacity: reveal,
                  transform: \`translateY(\${(1 - reveal) * 24}px)\`,
                }}
              >
                Your title
              </h1>
            </div>
          );
        }}
      </Sprite>
    </Stage>
  );
}
`;
}

export function createBlankProject(meta?: Partial<StageMeta>, name = "Untitled scene"): Project {
  const resolved = resolveMeta(meta ?? {}, BLANK_META);
  const warnings: string[] = [];
  const project = buildProject(
    { name, entrySource: blankSource(resolved), fallbackMeta: resolved, origin: "blank" },
    warnings,
  );
  if (warnings.length) throw new Error(`Blank project template failed to parse: ${warnings.join("; ")}`);
  return project;
}

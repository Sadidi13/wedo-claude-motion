/**
 * Runtime shape checks for data the preview page receives from outside its
 * own code (postMessage payloads, `/api/export/<id>/project` JSON,
 * localStorage). Deliberately structural, not exhaustive.
 */

import type { Project, StageMeta } from "@/lib/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isStageMetaLike(value: unknown): value is StageMeta {
  return (
    isRecord(value) && isNumber(value.width) && isNumber(value.height) && isNumber(value.duration) && isNumber(value.fps)
  );
}

export function isProjectLike(value: unknown): value is Project {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || typeof value.entry !== "string") return false;
  if (!isRecord(value.files) || !isStageMetaLike(value.meta)) return false;
  return Object.values(value.files).every(
    (file) => isRecord(file) && typeof file.path === "string" && typeof file.kind === "string" && typeof file.content === "string",
  );
}

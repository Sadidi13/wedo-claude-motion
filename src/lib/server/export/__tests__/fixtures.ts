/** Shared test fixtures for the export module: a minimal valid project + request builder. */
import type { ExportOptions, ExportRequest, Project } from "@/lib/types";

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-test",
    name: "Product Launch",
    entry: "scene.jsx",
    files: {
      "scene.jsx": { path: "scene.jsx", kind: "jsx", content: "export default function Scene() { return null; }" },
    },
    meta: { width: 320, height: 180, duration: 2, fps: 10, background: "#000" },
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    ...overrides,
  };
}

export function makeRequest(options: Partial<ExportOptions> = {}, project: Partial<Project> = {}): ExportRequest {
  return { project: makeProject(project), options: { format: "mp4", ...options } };
}

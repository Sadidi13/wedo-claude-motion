/**
 * Runtime validation of an incoming `ExportRequest` (CONTRACTS.md §6).
 *
 * The POST body comes straight from the browser, so the shape is checked with
 * zod before anything touches the filesystem. The project is validated
 * *loosely* (ids, entry, files, positive stage numbers) — the loader/preview
 * is the authority on whether the code inside actually runs.
 */

import { z } from "zod";
import type { ExportRequest } from "@/lib/types";

/** Thrown for a malformed request; routes map it to HTTP 400. */
export class ExportRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportRequestError";
  }
}

const positive = z.number().finite().positive();

const projectFileSchema = z.object({
  path: z.string().min(1),
  kind: z.enum(["jsx", "js", "tsx", "ts", "css", "html", "json", "asset"]),
  content: z.string(),
});

const stageMetaSchema = z.object({
  width: positive,
  height: positive,
  duration: positive,
  fps: positive,
  background: z.string().optional(),
});

const isoNow = () => new Date().toISOString();

const projectSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    entry: z.string().min(1),
    files: z.record(z.string(), projectFileSchema),
    meta: stageMetaSchema,
    createdAt: z.string().default(isoNow),
    updatedAt: z.string().default(isoNow),
    origin: z.enum(["sample", "claude-design-zip", "html", "jsx", "ai-generate", "blank"]).optional(),
  })
  .refine((p) => p.entry in p.files, { message: "project.entry must name a file in project.files", path: ["entry"] });

const rangeSchema = z
  .object({ start: z.number().finite().min(0), end: z.number().finite().positive() })
  .refine((r) => r.start < r.end, { message: "range.start must be smaller than range.end" });

const optionsSchema = z.object({
  format: z.enum(["mp4", "webm", "mov", "gif", "png-sequence"]),
  fps: z.number().finite().min(1).max(120).optional(),
  scale: z.union([z.literal(1), z.literal(2)]).optional(),
  range: rangeSchema.optional(),
  transparent: z.boolean().optional(),
  quality: z.number().int().min(0).max(51).optional(),
});

const exportRequestSchema = z.object({ project: projectSchema, options: optionsSchema });

/** Validates an unknown JSON body; throws `ExportRequestError` with a readable issue list. */
export function parseExportRequest(input: unknown): ExportRequest {
  const result = exportRequestSchema.safeParse(input);
  if (!result.success) throw new ExportRequestError(`Invalid export request:\n${z.prettifyError(result.error)}`);
  return result.data;
}

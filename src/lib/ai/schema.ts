/**
 * Zod schemas for the AI module (CONTRACTS §5).
 *
 * - `AiEditRequestSchema` validates the JSON body of POST /api/ai/edit. Its
 *   inferred type is structurally identical to `AiEditRequest` from
 *   "@/lib/types", so the route hands the parsed value straight to the service.
 * - `AiOutputSchema` is the structured-output contract Claude must satisfy:
 *   `{ summary, code, files? }`. The SDK turns it into a JSON schema via
 *   `zodOutputFormat`, and the service uses it again to re-validate text it
 *   parses itself (streaming path).
 */
import { z } from "zod";
import { isUnsafePath } from "@/lib/importer/files";

const PROJECT_FILE_KINDS = ["jsx", "js", "tsx", "ts", "css", "html", "json", "asset"] as const;
const PROJECT_ORIGINS = ["sample", "claude-design-zip", "html", "jsx", "ai-generate", "blank"] as const;

/** Upper bound for a designer's instruction; longer prompts are almost certainly pasted files. */
const MAX_PROMPT_CHARS = 20_000;
/** Prior turns kept for iteration; older turns add cost without adding much context. */
const MAX_HISTORY_TURNS = 40;

/**
 * Project file paths are written to disk by the Claude tools (motion-bridge `wait` / `project`),
 * so they must stay inside the project: no absolute or drive-letter paths, no "..", no control
 * characters. Spaces and non-Latin names are fine (imported assets have them).
 */
export const SafeProjectPathSchema = z
  .string()
  .min(1)
  .max(400)
  .refine((path) => !isUnsafePath(path) && !/[\u0000-\u001f\u007f]/.test(path), {
    message: "path must be a relative path inside the project (no '..', no leading '/', no drive letter)",
  });

const ProjectFileSchema = z.object({
  path: SafeProjectPathSchema,
  kind: z.enum(PROJECT_FILE_KINDS),
  content: z.string(),
});

const StageMetaSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  duration: z.number().positive(),
  fps: z.number().positive(),
  background: z.string().optional(),
});

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  entry: z.string().min(1),
  files: z.record(z.string(), ProjectFileSchema),
  meta: StageMetaSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  origin: z.enum(PROJECT_ORIGINS).optional(),
});

const ChatTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const FrameImageSchema = z.object({
  mediaType: z.enum(["image/png", "image/jpeg"]),
  data: z.string().min(1),
});

/** Request body of POST /api/ai/edit (mirrors `AiEditRequest`). */
export const AiEditRequestSchema = z
  .object({
    scope: z.enum(["layer", "scene", "new"]),
    prompt: z.string().trim().min(1, "prompt must not be empty").max(MAX_PROMPT_CHARS),
    project: ProjectSchema,
    layerId: z.string().min(1).optional(),
    history: z.array(ChatTurnSchema).max(MAX_HISTORY_TURNS).optional(),
    frameImage: FrameImageSchema.optional(),
  })
  .refine((req) => req.scope !== "layer" || req.layerId !== undefined, {
    message: 'layerId is required when scope is "layer"',
    path: ["layerId"],
  });

export type AiEditRequestInput = z.infer<typeof AiEditRequestSchema>;

const AiOutputFileSchema = z.object({
  path: z.string().describe('Relative project path of a helper file, e.g. "styles.css" or "Card.jsx"'),
  content: z.string().describe("Full new content of that file"),
});

/** What Claude must return (structured output). */
export const AiOutputSchema = z.object({
  summary: z
    .string()
    .describe("One short paragraph describing the change, in the same language as the designer's instruction"),
  code: z
    .string()
    .describe(
      'scope "layer": exactly one JSX element replacing the selected one (same data-layer-id). scope "scene" | "new": the complete entry file.',
    ),
  files: z
    .array(AiOutputFileSchema)
    .optional()
    .describe("New or updated helper files referenced by `code`. Omit when nothing else changed."),
});

export type AiOutput = z.infer<typeof AiOutputSchema>;
export type AiOutputFile = z.infer<typeof AiOutputFileSchema>;

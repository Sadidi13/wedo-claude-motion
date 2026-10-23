/**
 * What the bridge routes do besides storage (docs/CLAUDE-DESKTOP.md):
 *
 * - `buildBrief`: the request rendered as Markdown for the Claude session — the
 *   very same task, layer tree, line-numbered source and instruction the API
 *   path sends to the model (`buildMessages`), plus how to deliver the answer.
 * - `completeRequest`: Claude's `{ summary, code, files? }` for a claimed
 *   request, validated with `finalizeOutput` exactly like an API answer.
 * - `pushNewScene` / `pushEdit`: scenes and edits written in the desktop chat,
 *   validated the same way and queued as events for the open editor.
 */

import { z } from "zod";
import { AiOutputSchema, buildMessages, finalizeOutput } from "@/lib/ai";
import { createBlankProject } from "@/lib/importer";
import { fileKindFor, textFile } from "@/lib/importer/files";
import { parseScene } from "@/lib/parser";
import type { AiEditRequest, AiEditResponse, AiErrorResponse, BridgeEvent, ParsedScene, Project, ProjectFile } from "@/lib/types";
import { BridgeStateError, type BridgeRequestRecord, finishRequest, pushEvent, readSyncedProject } from "./store";

/** Body of POST /api/bridge/requests/[id]/result. */
export const BridgeResultSchema = z.union([AiOutputSchema, z.object({ error: z.string().trim().min(1).max(4_000) })]);

/** Body of POST /api/bridge/events. */
export const BridgePushSchema = z.discriminatedUnion("type", [
  AiOutputSchema.extend({
    type: z.literal("project"),
    name: z.string().trim().min(1).max(120),
  }),
  AiOutputSchema.extend({
    type: z.literal("edit"),
    prompt: z.string().max(20_000).default(""),
    layerId: z.string().min(1).optional(),
  }),
]);

export type BridgePush = z.infer<typeof BridgePushSchema>;

const SCOPE_LABEL = { layer: "selected layer", scene: "whole scene", new: "new scene" } as const;

function tryParse(source: string | undefined): ParsedScene | null {
  if (source === undefined) return null;
  try {
    return parseScene(source);
  } catch {
    return null;
  }
}

/** Markdown brief of one editor request for the Claude session that answers it. */
export function buildBrief(record: BridgeRequestRecord): string {
  const req = record.request;
  const scene = tryParse(req.project.files[req.project.entry]?.content);
  const messages = buildMessages(req, scene);
  const final = messages.at(-1);
  const history = messages.slice(0, -1);

  const finalText = Array.isArray(final?.content)
    ? final.content
        .map((block) => (block.type === "text" ? block.text : "(The designer attached a frame screenshot; it is not included here.)"))
        .join("\n\n")
    : String(final?.content ?? "");

  const parts = [
    `# Motion Studio request ${record.id}`,
    "",
    `- Scope: **${req.scope}** (${SCOPE_LABEL[req.scope]})`,
    ...(req.layerId ? [`- Layer: \`${req.layerId}\``] : []),
    `- Project: "${req.project.name}" (${req.project.id})`,
    `- Received: ${record.createdAt}`,
    "",
    "Answer by writing the code to a file and running:",
    "",
    "```bash",
    `node scripts/motion-bridge.mjs respond ${record.id} --summary "<one short paragraph, in the instruction's language>" --code <file>`,
    "```",
    "",
    'The rules for `code` are in the contract (`node scripts/motion-bridge.mjs contract`), section "Output format".',
    "If the instruction is not a change to this animation, decline it instead:",
    "",
    "```bash",
    `node scripts/motion-bridge.mjs fail ${record.id} "<short reason>"`,
    "```",
    "",
  ];
  if (history.length > 0) {
    parts.push("## Earlier turns on this layer / scene", "");
    for (const turn of history) {
      parts.push(`**${turn.role === "user" ? "Designer" : "Claude"}:** ${String(turn.content)}`, "");
    }
  }
  parts.push("## Request", "", finalText, "");
  return parts.join("\n");
}

/** Validate Claude's answer for a claimed request and store it; returns the editor-facing result. */
export async function completeRequest(
  record: BridgeRequestRecord,
  body: z.infer<typeof BridgeResultSchema>,
): Promise<AiEditResponse | AiErrorResponse> {
  if ("error" in body) {
    await finishRequest(record.id, { error: body.error });
    return { ok: false, code: "declined", error: body.error };
  }
  const result = finalizeOutput(record.request, body);
  // Invalid output leaves the request claimed so Claude can fix it and answer again.
  if (result.ok) await finishRequest(record.id, { result });
  return result;
}

function projectFromScene(name: string, response: AiEditResponse): Project {
  if (!response.sceneCode) throw new Error("The validated output has no scene code");
  const blank = createBlankProject(undefined, name);
  const files: Record<string, ProjectFile> = { ...blank.files };
  for (const file of response.files ?? []) {
    const kind = fileKindFor(file.path);
    files[file.path] = textFile(file.path, kind && kind !== "asset" ? kind : "js", file.content);
  }
  files[blank.entry] = textFile(blank.entry, "jsx", response.sceneCode);
  return { ...blank, files, meta: parseScene(response.sceneCode).meta, origin: "ai-generate" };
}

export type PushResult =
  | { ok: true; event: BridgeEvent; layers: number }
  | { ok: false; status: number; error: string };

/** A complete new scene written in the desktop chat: validated, then queued for the editor. */
export async function pushNewScene(push: Extract<BridgePush, { type: "project" }>): Promise<PushResult> {
  const request: AiEditRequest = { scope: "new", prompt: push.name, project: createBlankProject(undefined, push.name) };
  const result = finalizeOutput(request, push);
  if (!result.ok) return { ok: false, status: 422, error: result.error };
  const project = projectFromScene(push.name, result);
  const event = await pushEvent({ type: "project", project, summary: result.summary });
  return { ok: true, event, layers: parseScene(result.sceneCode ?? "").layers.length };
}

/** An edit of the project the editor has open, written in the desktop chat. */
export async function pushEdit(push: Extract<BridgePush, { type: "edit" }>): Promise<PushResult> {
  const synced = await readSyncedProject();
  if (!synced) {
    return { ok: false, status: 409, error: "No project shared yet: open Motion Studio in a browser first" };
  }
  const request: AiEditRequest = {
    scope: push.layerId ? "layer" : "scene",
    prompt: push.prompt || push.summary,
    project: synced.project,
    ...(push.layerId ? { layerId: push.layerId } : {}),
  };
  const result = finalizeOutput(request, push);
  if (!result.ok) return { ok: false, status: result.code === "bad_request" ? 400 : 422, error: result.error };
  const sceneSource = result.sceneCode ?? synced.project.files[synced.project.entry]?.content ?? "";
  const event = await pushEvent({
    type: "edit",
    projectId: synced.project.id,
    prompt: push.prompt,
    ...(push.layerId ? { layerId: push.layerId } : {}),
    response: result,
  });
  return { ok: true, event, layers: tryParse(sceneSource)?.layers.length ?? 0 };
}

export { BridgeStateError };

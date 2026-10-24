/**
 * Applying Claude's edits to the editor, shared by the three ways an edit can
 * arrive: an API reply (/api/ai/edit), a Claude Desktop answer to a queued
 * request, and an edit Claude pushed from the desktop chat. Each successful
 * edit goes through the store's history, so one Undo reverts it, and is saved
 * as a version (store/versions.ts) labelled with Claude's summary.
 */
import { createBlankProject } from "@/lib/importer";
import type { AiEditResponse, AiErrorResponse, AiScope, Project, ProjectFile } from "@/lib/types";
import { errorMessage, useEditorStore } from "./editorStore";
import { saveVersion } from "./versions";

function fileKind(path: string): ProjectFile["kind"] {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return ext === "jsx" || ext === "js" || ext === "tsx" || ext === "ts" || ext === "css" || ext === "html" || ext === "json" ? ext : "asset";
}

/** Apply a successful response to the store; throws when the code does not parse. */
export function applyResponse(response: AiEditResponse, scope: AiScope, layerId: string | null): void {
  const store = useEditorStore.getState();
  const extraFiles = response.files ?? [];
  if (scope === "layer") {
    if (!layerId || !response.layerCode) throw new Error("The reply did not contain layer code");
    store.replaceLayer(layerId, response.layerCode);
    for (const file of extraFiles) store.updateFile(file.path, file.content);
    return;
  }
  if (!response.sceneCode) throw new Error("The reply did not contain scene code");
  if (scope === "scene") {
    store.setSource(response.sceneCode);
    for (const file of extraFiles) store.updateFile(file.path, file.content);
    return;
  }
  const blank = createBlankProject(store.scene?.meta, "Generated scene");
  const files: Record<string, ProjectFile> = { ...blank.files };
  for (const file of extraFiles) files[file.path] = { path: file.path, kind: fileKind(file.path), content: file.content };
  files[blank.entry] = { path: blank.entry, kind: "jsx", content: response.sceneCode };
  const project: Project = { ...blank, files, origin: "ai-generate" };
  store.loadProject(project);
}

export interface AiTurnContext {
  scope: AiScope;
  layerId: string | null;
  /** chat thread key (`chatKeyFor(scope, layerId)`) */
  key: string;
  /** the designer's instruction (re-added to the new project's thread for scope "new") */
  prompt: string;
}

/**
 * Apply a reply and record it in the Ask Claude thread. The designer's turn is
 * expected to be in the thread already, except for scope "new", whose project
 * replaces the thread: the turn is added after loading.
 */
export function applyAiResult(body: AiEditResponse | AiErrorResponse, ctx: AiTurnContext): boolean {
  const store = useEditorStore.getState();
  if (!body.ok) {
    store.appendChat(ctx.key, { role: "assistant", content: `${body.error} (${body.code})`, status: "error" });
    return false;
  }
  try {
    applyResponse(body, ctx.scope, ctx.layerId);
  } catch (applyError) {
    useEditorStore.getState().appendChat(ctx.key, {
      role: "assistant",
      content: `${body.summary}\n\nCould not apply the change: ${errorMessage(applyError)}`,
      status: "error",
    });
    return false;
  }
  const after = useEditorStore.getState();
  if (after.project) void saveVersion(after.project, `Claude: ${body.summary.replace(/\s+/g, " ").trim()}`);
  if (ctx.scope === "new") after.appendChat("scene", { role: "user", content: ctx.prompt });
  after.appendChat(ctx.scope === "new" ? "scene" : ctx.key, { role: "assistant", content: body.summary, status: "applied" });
  return true;
}

/**
 * Shared data model for Motion Studio.
 *
 * Source of truth for a project is CODE: a Claude-Motion-style JSX file that
 * renders a <Stage> with <Sprite> children. Layers are a *view* over that
 * code (one layer per JSX element inside the Stage subtree, identified by a
 * stable `data-layer-id` attribute written into the source).
 *
 * Every module (parser, loader/preview, editor UI, AI routes, export, importer)
 * must build against the types in this file. See docs/CONTRACTS.md.
 */

// ---------------------------------------------------------------------------
// Stage / project
// ---------------------------------------------------------------------------

export interface StageMeta {
  /** canvas width in CSS px */
  width: number;
  /** canvas height in CSS px */
  height: number;
  /** total duration in seconds */
  duration: number;
  /** frames per second used for export + timeline snapping */
  fps: number;
  /** CSS background (color / gradient). Empty/undefined = transparent */
  background?: string;
}

export type ProjectFileKind = "jsx" | "js" | "tsx" | "ts" | "css" | "html" | "json" | "asset";

export interface ProjectFile {
  /** relative path inside the project, posix style, no leading "./" (e.g. "scene.jsx", "assets/logo.png") */
  path: string;
  kind: ProjectFileKind;
  /**
   * Text content for source files.
   * For `kind === "asset"` this is a data: URL (base64) so projects are self-contained
   * and serialisable to JSON / localStorage.
   */
  content: string;
}

export interface Project {
  id: string;
  name: string;
  /** path of the file that renders <Stage> (default "scene.jsx") */
  entry: string;
  files: Record<string, ProjectFile>;
  /** derived from the <Stage> props of the entry file; kept in sync by the store */
  meta: StageMeta;
  createdAt: string;
  updatedAt: string;
  /** where this project came from (for UX only) */
  origin?: "sample" | "claude-design-zip" | "html" | "jsx" | "ai-generate" | "blank";
}

// ---------------------------------------------------------------------------
// Layers (view over the entry file's JSX)
// ---------------------------------------------------------------------------

export type LayerKind =
  | "sprite" // <Sprite start end>
  | "audio" // <Audio src|sfx start end>: a sound clip, timed like a Sprite
  | "text" // element whose only children are text/expressions
  | "image" // <img> / <Image>
  | "shape" // <svg>, <div> with no text children, <circle> …
  | "group" // element with element children (container)
  | "canvas" // <Three3D> (a three.js scene) or <canvas>: one drawn layer, no sub-layers inside
  | "component" // custom React component (capitalised tag, not Sprite)
  | "element"; // anything else

export interface SourceRange {
  /** 0-based char offset in the entry file (inclusive) */
  start: number;
  /** 0-based char offset in the entry file (exclusive) */
  end: number;
  /** 1-based line of the opening tag */
  line: number;
}

export interface LayerNode {
  /** stable id, mirrors the `data-layer-id` attribute in the source */
  id: string;
  /** user-facing name: `data-layer-name` attr if present, otherwise derived (tag + text preview) */
  name: string;
  kind: LayerKind;
  /** JSX element name as written ("Sprite", "div", "Title", "svg"...) */
  tag: string;
  /**
   * Timing declared on THIS element (only for `<Sprite start end>` / `<Audio start end>` whose props are
   * numeric literals). `undefined` when not timed or when the prop is a dynamic expression.
   */
  start?: number;
  end?: number;
  /** Effective visible range in seconds after intersecting with all ancestor Sprites. */
  range: { start: number; end: number };
  /** `data-hidden="true"` present on the element */
  hidden: boolean;
  /** `data-locked="true"` present on the element (UI-only guard, ignored by runtime) */
  locked: boolean;
  /** first ~60 chars of static text content, for the layers panel */
  textPreview?: string;
  parentId: string | null;
  depth: number;
  children: LayerNode[];
  /** source range of the whole JSX element (opening tag → closing tag) in the entry file */
  loc: SourceRange;
  /** <Audio> clips: the literal props the inspector edits (undefined = not literal / not set) */
  audio?: LayerAudio;
  /** the editor's move / scale / rotate / opacity (static or keyframed) from `data-motion` */
  motion?: import("@/lib/motion/keyframes").MotionSpec;
}

export interface LayerAudio {
  src?: string;
  sfx?: string;
  from?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  loop: boolean;
}

export interface ParsedScene {
  meta: StageMeta;
  /** top-level layers = direct JSX children of <Stage> */
  layers: LayerNode[];
  /** flat index for O(1) lookup */
  byId: Record<string, LayerNode>;
  /** source range of the <Stage> element itself */
  stageLoc: SourceRange;
  /** non-fatal issues (e.g. dynamic Sprite timing that cannot be edited numerically) */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Preview <-> editor postMessage protocol (see docs/CONTRACTS.md §3)
// ---------------------------------------------------------------------------

export interface LayerRect {
  id: string;
  /** rect in STAGE coordinates (CSS px of the un-scaled canvas) */
  x: number;
  y: number;
  width: number;
  height: number;
  /** seen at the current frame (displayed, not hidden, combined opacity above ~5%); absent = unknown */
  visible?: boolean;
}

/** editor -> preview iframe */
export type EditorToPreviewMessage =
  | { type: "load"; project: Project; time?: number }
  | { type: "seek"; time: number }
  | { type: "getLayerRects" }
  | { type: "highlight"; id: string | null }
  | { type: "setTransparent"; transparent: boolean }
  /** the editor's transport: <Audio> layers play while it plays (and not when muted) */
  | { type: "playback"; playing: boolean; muted: boolean }
  /** live layer motion while the designer drags (a data-motion JSON); null returns to the code's own */
  | { type: "motionOverride"; id: string; motion: string | null };

/** preview iframe -> editor */
export type PreviewToEditorMessage =
  | { type: "ready"; meta: StageMeta }
  | { type: "layerRects"; rects: LayerRect[] }
  | { type: "select"; id: string | null }
  | { type: "error"; message: string; stack?: string }
  | { type: "warning"; message: string };

// ---------------------------------------------------------------------------
// AI (server routes under /api/ai) — see docs/CONTRACTS.md §5
// ---------------------------------------------------------------------------

export type AiScope = "layer" | "scene" | "new";

export interface AiChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AiEditRequest {
  scope: AiScope;
  /** natural-language instruction from the designer */
  prompt: string;
  /** full project (files + entry + meta) for context. For scope "new" may be a blank project. */
  project: Project;
  /** required when scope === "layer" */
  layerId?: string;
  /** optional prior turns for the same layer / scene so the user can iterate */
  history?: AiChatTurn[];
  /** optional base64 PNG screenshot of the current frame to give Claude visual context */
  frameImage?: { mediaType: "image/png" | "image/jpeg"; data: string };
}

export interface AiEditResponse {
  ok: true;
  scope: AiScope;
  /** one-paragraph description of what changed, in the user's language */
  summary: string;
  /** for scope "layer": the replacement JSX for that single element (same data-layer-id preserved) */
  layerCode?: string;
  /** for scope "scene" | "new": the full new entry-file source */
  sceneCode?: string;
  /** optional extra/updated source files (css, helper components) */
  files?: { path: string; content: string }[];
  /** usage info for the UI */
  usage?: { inputTokens: number; outputTokens: number; model: string };
}

export interface AiErrorResponse {
  ok: false;
  error: string;
  /** e.g. "missing_api_key" | "invalid_output" | "refusal" | "api_error" */
  code: string;
}

// ---------------------------------------------------------------------------
// Export (server routes under /api/export) — see docs/CONTRACTS.md §6
// ---------------------------------------------------------------------------

export type ExportFormat = "mp4" | "webm" | "mov" | "gif" | "png-sequence";

export interface ExportOptions {
  format: ExportFormat;
  /** override fps (default: project.meta.fps) */
  fps?: number;
  /** render scale factor: 1 = native stage size, 2 = 2x (e.g. 1920x1080 -> 3840x2160) */
  scale?: 1 | 2;
  /** in/out points in seconds (default: whole stage) */
  range?: { start: number; end: number };
  /** keep alpha channel (webm / mov / png-sequence only). mp4 + gif are always opaque. */
  transparent?: boolean;
  /** H.264 CRF for mp4 (default 17) */
  quality?: number;
  /** mix the project's <Audio> layers into the file (default true; gif never has sound) */
  audio?: boolean;
}

export interface ExportRequest {
  project: Project;
  options: ExportOptions;
}

export type ExportJobState = "queued" | "rendering" | "encoding" | "done" | "error";

export interface ExportJobStatus {
  jobId: string;
  state: ExportJobState;
  /** 0..1 */
  progress: number;
  framesDone: number;
  framesTotal: number;
  /** present when state === "done" */
  downloadUrl?: string;
  fileName?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

// ---------------------------------------------------------------------------
// Claude Desktop bridge (server routes under /api/bridge) — see docs/CLAUDE-DESKTOP.md
// ---------------------------------------------------------------------------

/**
 * "listening": a `motion-bridge wait` process polled within the last few seconds.
 * "busy": nobody is polling, but a request is claimed (Claude is working on it).
 * "offline": neither; new requests queue until Claude starts listening again.
 */
export type BridgeListenerState = "listening" | "busy" | "offline";

/** What answers editor requests: a Code session's CLI, the chat's MCP connector, or the autopilot. */
export type BridgeClient = "cli" | "mcp" | "headless";

export interface BridgeStatus {
  listener: BridgeListenerState;
  /** epoch ms of the last poll from the listener, or null when it never polled */
  lastSeen: number | null;
  /** who polled last: a Code session ("cli"), the chat connector ("mcp") or the autopilot ("headless") */
  listenerClient: BridgeClient | null;
  /** an editor tab polled for events within the last few seconds */
  editorOpen: boolean;
  /** id of the bridge state folder this server uses (added by the status route; tools match it) */
  instance?: string;
  /** requests waiting to be claimed */
  pending: number;
  /** the project the editor last shared with the server */
  project: { id: string; name: string; syncedAt: string } | null;
}

export type BridgeRequestState = "pending" | "claimed" | "done" | "error" | "cancelled";

// ---------------------------------------------------------------------------
// Storyboard boards (docs/STORYBOARD.md): every new video goes style frames →
// storyboard → approved build. Boards live in the bridge state folder.
// ---------------------------------------------------------------------------

/** One style direction, shown as a single key frame rendered from its own scene code. */
export interface BoardStyle {
  /** "a", "b", … in proposal order */
  id: string;
  name: string;
  /** why it fits the brief, one sentence */
  description: string;
  /** complete entry file (validated like a new scene) */
  code: string;
  files?: { path: string; content: string }[];
  /** second of `code` that shows the key frame */
  time: number;
}

export interface BoardShot {
  /** "s1", "s2", … in order */
  id: string;
  title: string;
  /** seconds in the final video */
  start: number;
  end: number;
  /** what we see and how it moves */
  action: string;
  /** on-screen text, exactly as it will appear */
  text?: string;
  /** music / sound-effect cue */
  audio?: string;
  /** optional still sketch of the shot in the chosen style (complete entry file) */
  code?: string;
  files?: { path: string; content: string }[];
  /** second of `code` to show */
  time?: number;
}

/** An image or video the designer gave as a reference for the look (docs/STORYBOARD.md). */
export interface BoardReference {
  /** "r1", "r2", … */
  id: string;
  /** the file's name as uploaded (display only) */
  name: string;
  kind: "image" | "video";
  /** stored file name, r<n>.<ext> */
  file: string;
  /** JPEG Claude looks at: the downscaled image, or a contact sheet of the video's frames */
  preview: string;
  /** video only: seconds */
  duration?: number;
  /** video only: the times of the sheet's frames, left to right, top to bottom */
  frames?: number[];
}

export type BoardStatus =
  | "styles-pending" // waiting for Claude's style frames
  | "choose-style" // the designer picks one
  | "storyboard-pending" // waiting for Claude's storyboard
  | "storyboard" // the designer approves it or asks for changes
  | "build-pending" // approved: waiting for Claude to build the video
  | "built";

/** What the designer (or Claude, on the designer's word in the chat) did with a board. */
export type BoardAction = "new" | "choose-style" | "restyle" | "revise-storyboard" | "approve";

export interface BoardNote {
  at: string;
  stage: "styles" | "storyboard" | "build";
  text: string;
}

export interface Board {
  id: string;
  title: string;
  /** the request the video is made for */
  brief: string;
  meta: StageMeta;
  status: BoardStatus;
  styles: BoardStyle[];
  chosenStyleId: string | null;
  shots: BoardShot[];
  /** Claude's notes on the storyboard (music, pacing) */
  storyboardNotes: string;
  /** increments each time Claude proposes styles / a storyboard */
  stylesRevision: number;
  storyboardRevision: number;
  /** the designer's notes, oldest first */
  notes: BoardNote[];
  /** reference images / videos for the look (absent on boards saved before references existed) */
  references?: BoardReference[];
  /** project made from this board, once built */
  projectId: string | null;
  /** the request queued for Claude about this board's current step, until Claude answers it */
  waitingRequestId: string | null;
  /** why Claude declined the last step, shown on the board */
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Board list entry (GET /api/bridge/boards). */
export interface BoardSummary {
  id: string;
  title: string;
  status: BoardStatus;
  updatedAt: string;
}

/** What the editor sees when it polls one request (the request body itself is not echoed back). */
export interface BridgeRequestView {
  id: string;
  state: BridgeRequestState;
  createdAt: string;
  claimedAt?: string;
  finishedAt?: string;
  /** set when state === "done": the validated edit, ready for the editor to apply */
  result?: AiEditResponse;
  /** set when state === "error" */
  error?: string;
}

/** Changes Claude pushed from the desktop chat, delivered to the open editor in order. */
export type BridgeEvent =
  | { id: string; at: string; type: "project"; project: Project; summary: string; boardId?: string }
  | {
      id: string;
      at: string;
      /** a storyboard step is ready for the designer: the editor opens the board */
      type: "board";
      boardId: string;
      summary: string;
    }
  | {
      id: string;
      at: string;
      type: "edit";
      /** the project the edit was made against; the editor ignores it for any other project */
      projectId: string;
      prompt: string;
      layerId?: string;
      response: AiEditResponse;
    };

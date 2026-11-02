#!/usr/bin/env node
/**
 * motion-autopilot — answers Motion Studio's Ask Claude requests on its own
 * (docs/CLAUDE-DESKTOP.md). It polls the bridge about once a second, which
 * only talks to the local server and costs no Claude usage. When the designer
 * sends a request, it runs Claude Code once in print mode (`claude -p`, with
 * the user's own Claude login), with no tools and the authoring guide as the
 * system prompt, and sends the JSON answer back. The answer is validated like
 * every other answer; an invalid one gets one retry with the error, then the
 * request is declined with the reason.
 *
 * The New video wizard's conversation is answered here too (only the autopilot takes its turns):
 * one quick run per designer message, a JSON reply with the next question or the finished order.
 *
 * Storyboard steps (docs/STORYBOARD.md) are handled the same way: a new video
 * from the editor gets style frames, the designer's choice gets a storyboard,
 * the approval gets the built video, each as one Claude Code run. A built
 * video then goes through the local quality check (docs/QUALITY.md); when it
 * finds real errors, one more run fixes them.
 *
 *   node scripts/motion-autopilot.mjs [--model <alias>] [--once]
 *
 * Every run uses the same model (default claude-opus-5-5). Storyboard steps, the build and its
 * quality pass are "deep" work and run at a higher effort than everyday edits.
 *
 * The editor usually starts and stops this script itself (src/lib/server/bridge/autopilot.ts);
 * it reports what it is doing in <bridge>/autopilot.json either way.
 *
 * Environment: MOTION_STUDIO_CLAUDE_BIN (default: `claude` on PATH, then
 * ~/.local/bin/claude.exe), MOTION_STUDIO_AUTOPILOT_MODEL (default claude-opus-5-5),
 * MOTION_STUDIO_AUTOPILOT_EFFORT_DEEP (default xhigh), MOTION_STUDIO_AUTOPILOT_EFFORT (default
 * high), plus the MOTION_STUDIO_URL / MOTION_STUDIO_BRIDGE_DIR of the bridge client.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BASE,
  BRIDGE_DIR,
  BridgeError,
  BridgeValidationError,
  answer,
  answerIntake,
  boardReferenceFiles,
  checkQuality,
  claim,
  decline,
  getContract,
  getProject,
  proposeStoryboard,
  proposeStyles,
  push,
  resolveBase,
  sleep,
} from "./lib/bridge-client.mjs";

const DEFAULT_MODEL = "claude-opus-5-5";
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
/** How long one run may take: deep work (a whole video at a high effort) gets longer. */
const RUN_TIMEOUT_MS = { deep: 30 * 60_000, normal: 10 * 60_000 };
const POLL_MS = 1_000;
/** While Claude works, the state file is refreshed this often so the editor shows "working", not "offline". */
const HEARTBEAT_MS = 5_000;
/** Otherwise it is re-written this often, so the editor's view heals if something overwrote it. */
const KEEPALIVE_MS = 30_000;
/** Started by the editor's server (src/lib/server/bridge/autopilot.ts): stop once that server has been gone this long. */
const MANAGED = process.env.MOTION_STUDIO_AUTOPILOT_MANAGED === "1";
const SERVER_GONE_MS = 10 * 60_000;
/** Cleared at start when the installed Claude Code does not know `--effort`. */
let effortSupported = true;
/** Set when Claude Code says the model needs a newer version: the autopilot stops and the editor offers the update. */
let outdated = null;
/** Private, empty working folder (created at start): no project files, CLAUDE.md or settings around Claude Code. */
let WORK_DIR = "";
let CONTRACT_FILE = "";
/** The wizard's conversation needs no authoring contract: a short system prompt keeps each turn quick. */
let INTAKE_FILE = "";
const INTAKE_SYSTEM =
  "You help a designer set up a new video in WeDo Claude Motion, a motion-design editor, before any design work. " +
  "You ask short, friendly questions in the designer's language and reply with exactly the JSON object the message asks for, nothing else.";

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--once") flags.once = true;
    else if (argv[i] === "--model") flags.model = argv[++i];
    else if (argv[i].startsWith("--model=")) flags.model = argv[i].slice("--model=".length);
  }
  return flags;
}

function timestamp() {
  return new Date().toLocaleTimeString();
}

function say(message) {
  console.log(`[${timestamp()}] ${message}`);
}

/** The effort for one kind of run: "deep" (storyboard steps, builds, their quality pass) or "normal" (edits). */
function effortFor(kind) {
  if (!effortSupported) return undefined;
  const value = kind === "deep" ? (process.env.MOTION_STUDIO_AUTOPILOT_EFFORT_DEEP ?? "xhigh") : (process.env.MOTION_STUDIO_AUTOPILOT_EFFORT ?? "high");
  return EFFORTS.has(value) ? value : undefined;
}

// ---------------------------------------------------------------------------
// What the editor sees (<bridge>/autopilot.json, read by src/lib/server/bridge/autopilot.ts)
// ---------------------------------------------------------------------------

const STATE_FILE = path.join(BRIDGE_DIR, "autopilot.json");
const stateBase = { pid: process.pid, model: null, effort: null, startedAt: new Date().toISOString() };
/** The state written when the process exits (signed-out / error replace the default). */
let exitState = { state: "stopped", message: null };
/** The state last reported (re-written by the keepalive). */
let current = { state: "starting", message: null };

function report(state, message = null) {
  current = { state, message };
  try {
    mkdirSync(BRIDGE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify({ ...stateBase, state, message, updatedAt: Date.now() }));
  } catch {
    // the editor shows the process as running anyway; nothing else depends on this file
  }
}

/** Run `work` while telling the editor it is working (refreshed every few seconds), then back to listening. */
async function working(what, work) {
  report("working", what);
  const beat = setInterval(() => report("working", what), HEARTBEAT_MS);
  try {
    return await work();
  } finally {
    clearInterval(beat);
    report("listening");
  }
}

// ---------------------------------------------------------------------------
// One autopilot at a time: <bridge>/autopilot.lock holds the running one's pid
// ---------------------------------------------------------------------------

const LOCK_FILE = path.join(BRIDGE_DIR, "autopilot.lock");

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM"; // exists, owned by someone else
  }
}

/** Take the lock (released on exit). Returns the pid of another running autopilot instead, when there is one. */
function acquireLock() {
  mkdirSync(BRIDGE_DIR, { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync(LOCK_FILE, String(process.pid), { flag: "wx" });
      process.once("exit", () => {
        try {
          if (readFileSync(LOCK_FILE, "utf8").trim() === String(process.pid)) rmSync(LOCK_FILE, { force: true });
        } catch {
          // already gone
        }
      });
      return null;
    } catch (error) {
      if (error.code !== "EEXIST") return null; // the folder cannot hold a lock: run without one
    }
    let holder = 0;
    try {
      holder = Number(readFileSync(LOCK_FILE, "utf8").trim());
    } catch {
      continue; // removed in the meantime
    }
    if (holder !== process.pid && isAlive(holder)) return holder;
    rmSync(LOCK_FILE, { force: true }); // left by an autopilot that was killed
  }
  return null;
}

/** The Claude Code executable: MOTION_STUDIO_CLAUDE_BIN, `claude` on PATH, or the native installer's location. */
function claudeCommand() {
  if (process.env.MOTION_STUDIO_CLAUDE_BIN) return process.env.MOTION_STUDIO_CLAUDE_BIN;
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["claude"], { encoding: "utf8", windowsHide: true });
  const onPath = probe.status === 0 ? probe.stdout.split(/\r?\n/).find((line) => line.trim()) : undefined;
  if (onPath) return onPath.trim();
  const native = path.join(os.homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
  return existsSync(native) ? native : "claude";
}

/** A clean environment: no variables of a Claude Code session this happens to be started from. */
function childEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("CLAUDE") && key !== "CLAUDE_CONFIG_DIR") delete env[key];
  }
  return env;
}

/** [command, args]: a .cmd/.bat goes through cmd.exe (Node refuses to run them directly). */
function commandLine(bin, args) {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(bin)) {
    return [process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", bin, ...args]];
  }
  return [bin, args];
}

function spawnClaude(bin, args, options) {
  const [command, commandArgs] = commandLine(bin, args);
  return spawn(command, commandArgs, options);
}

function checkLogin(bin) {
  const [command, args] = commandLine(bin, ["auth", "status"]);
  const result = spawnSync(command, args, { encoding: "utf8", env: childEnv(), windowsHide: true });
  if (result.error) return { ok: false, reason: `Could not run Claude Code (${bin}): ${result.error.message}` };
  try {
    const status = JSON.parse(result.stdout);
    return status.loggedIn ? { ok: true, method: status.authMethod } : { ok: false, reason: "Claude Code is not signed in" };
  } catch {
    return { ok: true, method: "unknown" }; // older CLIs print text; let the first run tell
  }
}

/** Whether this Claude Code knows `--effort` (older versions refuse unknown flags). */
function knowsEffortFlag(bin) {
  const [command, args] = commandLine(bin, ["--help"]);
  const result = spawnSync(command, args, { encoding: "utf8", env: childEnv(), windowsHide: true, timeout: 30_000 });
  return /--effort\b/.test(`${result.stdout ?? ""}${result.stderr ?? ""}`);
}

/** The final "result" event of Claude Code's output: one JSON object, or the last result line of a stream. */
function readResult(stdout, streaming) {
  if (!streaming) return JSON.parse(stdout);
  let result = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event?.type === "result") result = event;
    } catch {
      // not an event line
    }
  }
  if (!result) throw new Error("no result event");
  return result;
}

/**
 * One `claude -p` run. Resolves with the model's text; rejects with a readable message. With
 * `images` (base64 JPEGs: a storyboard's reference previews) the prompt goes in as one stream-json
 * user message holding the text and the images. `kind` picks the effort and the time limit.
 */
function runClaude(bin, prompt, { model, kind = "normal", images = [], system = CONTRACT_FILE }) {
  const streaming = images.length > 0;
  const effort = effortFor(kind);
  const timeoutMs = RUN_TIMEOUT_MS[kind] ?? RUN_TIMEOUT_MS.normal;
  // No tools, no MCP servers, no settings/hooks/CLAUDE.md, no saved session: a request can only produce text.
  const args = [
    "-p",
    "--output-format",
    streaming ? "stream-json" : "json",
    ...(streaming ? ["--input-format", "stream-json", "--verbose"] : []),
    "--system-prompt-file",
    system,
    "--tools",
    "",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--no-session-persistence",
  ];
  if (model) args.push("--model", model);
  if (effort) args.push("--effort", effort);
  say(`  Claude Code: ${model ?? "default model"}, effort ${effort ?? "default"}`);
  return new Promise((resolve, reject) => {
    const child = spawnClaude(bin, args, { cwd: WORK_DIR, env: childEnv(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Claude Code did not finish within ${timeoutMs / 60_000} minutes`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Could not start Claude Code (${bin}): ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let result;
      try {
        result = readResult(stdout, streaming);
      } catch {
        const detail = (stderr || stdout).trim().split(/\r?\n/).slice(-5).join(" ");
        reject(new Error(`Claude Code exited with code ${code}: ${detail || "no output"}`));
        return;
      }
      if (result.is_error || result.subtype !== "success") {
        const detail = String(result.result ?? result.subtype ?? "unknown").slice(0, 400);
        // A model newer than this Claude Code: every run would fail the same way until it is updated.
        if (/does not support this model|or newer is required/i.test(detail)) {
          outdated = `This Claude Code is too old for ${model ?? "the model"}. Update it (the Autopilot panel's "Update Claude Code", or claude update), then start the autopilot again.`;
        }
        reject(new Error(`Claude Code reported an error: ${detail}`));
        return;
      }
      resolve({ text: String(result.result ?? ""), seconds: Math.round((result.duration_ms ?? 0) / 1000) });
    });
    if (!streaming) {
      child.stdin.end(prompt, "utf8");
      return;
    }
    const content = [
      { type: "text", text: prompt },
      ...images.map((data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } })),
    ];
    child.stdin.end(`${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`, "utf8");
  });
}

/** The JSON object in the model's reply text (fences and stray prose around it are tolerated). */
function parseJsonObject(text) {
  let body = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(body);
  if (fenced) body = fenced[1].trim();
  if (!body.startsWith("{")) {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) body = body.slice(start, end + 1);
  }
  try {
    const json = JSON.parse(body);
    if (json === null || typeof json !== "object" || Array.isArray(json)) throw new Error("not an object");
    return json;
  } catch (error) {
    throw new BridgeValidationError(`The reply is not a JSON object (${error.message})`);
  }
}

/** `{ summary, code, files? }` or `{ error }` from the model's reply text. */
function parseReply(text) {
  const json = parseJsonObject(text);
  if (typeof json?.error === "string" && json.error.trim()) return { error: json.error.trim() };
  if (typeof json?.summary !== "string" || typeof json?.code !== "string") {
    throw new BridgeValidationError('The reply must have string fields "summary" and "code"');
  }
  const files = Array.isArray(json.files) ? json.files.filter((f) => typeof f?.path === "string" && typeof f?.content === "string") : undefined;
  const texts = Array.isArray(json.texts) ? json.texts.filter((t) => typeof t?.key === "string" && typeof t?.value === "string") : undefined;
  return { summary: json.summary, code: json.code, files: files?.length ? files : undefined, ...(texts?.length ? { texts } : {}) };
}

/** Deliver one storyboard step from the model's JSON reply; throws BridgeValidationError when it does not fit. */
async function deliverBoardStep(request, reply) {
  if (request.deliverable === "styles") {
    if (!Array.isArray(reply.styles) || reply.styles.length === 0) throw new BridgeValidationError('The reply must have a non-empty "styles" array');
    const board = await proposeStyles({
      boardId: request.boardId,
      ...(typeof reply.title === "string" && reply.title.trim() ? { title: reply.title.trim() } : {}),
      ...(reply.stage && typeof reply.stage === "object" ? { stage: reply.stage } : {}),
      ...(typeof reply.styleSpec === "string" && reply.styleSpec.trim() ? { styleSpec: reply.styleSpec.trim() } : {}),
      styles: reply.styles,
    });
    return { message: `Proposed ${board.styles.length} style frames: ${board.styles.map((style) => style.name).join(", ")}` };
  }
  if (request.deliverable === "storyboard") {
    if (!Array.isArray(reply.shots) || reply.shots.length === 0) throw new BridgeValidationError('The reply must have a non-empty "shots" array');
    const board = await proposeStoryboard(request.boardId, { notes: typeof reply.notes === "string" ? reply.notes : "", shots: reply.shots });
    return { message: `Storyboard with ${board.shots.length} shots` };
  }
  if (typeof reply.summary !== "string" || typeof reply.code !== "string") {
    throw new BridgeValidationError('The reply must have string fields "summary" and "code"');
  }
  const files = Array.isArray(reply.files) ? reply.files.filter((f) => typeof f?.path === "string" && typeof f?.content === "string") : [];
  const result = await push({
    type: "project",
    name: request.board.title,
    summary: reply.summary,
    code: reply.code,
    ...(files.length ? { files } : {}),
    boardId: request.boardId,
  });
  return { message: `Built the video (${result.layers} top-level layers)`, built: { eventId: result.eventId, projectId: result.projectId, code: reply.code } };
}

/** Wait until the editor shared the project with this id (it loads a new scene within a few seconds). */
async function waitForOpenProject(projectId, seconds = 20) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    try {
      const { project } = await getProject();
      if (project.id === projectId) return true;
    } catch {
      // nothing shared yet
    }
    await sleep(1000);
  }
  return false;
}

/** After a build: the local quality check, and one Claude run to fix real errors (warnings are left to the designer). */
async function polishBuiltVideo(bin, model, built) {
  let report;
  try {
    ({ report } = await checkQuality(built.eventId));
  } catch (error) {
    say(`  Quality check skipped: ${error.message}`);
    return;
  }
  const errors = report.issues.filter((issue) => issue.severity === "error");
  if (errors.length === 0) {
    say(`  Quality check: ${report.issues.length ? `${report.issues.length} suggestion(s), no errors` : "no problems"}`);
    return;
  }
  say(`  Quality check: ${errors.length} problem(s); asking Claude to fix them`);
  if (!(await waitForOpenProject(built.projectId))) {
    say("  The editor did not open the new video, so the fixes were not sent. Use Check in the editor.");
    return;
  }
  const prompt = [
    "You built the video below. A quality check that rendered it found these problems:",
    "",
    ...errors.map((issue) => `- ${issue.start.toFixed(1)}-${issue.end.toFixed(1)}s${issue.layerId ? ` (layer ${issue.layerId})` : ""}: ${issue.message}`),
    "",
    "Fix them and keep everything else exactly as it is: the same layers, data-layer-id values, timing and style.",
    'Reply with ONLY a JSON object: {"summary": "<one sentence, in the language of the video\'s text>", "code": "<the complete corrected entry file>"}',
    "",
    "# The video",
    "",
    "```jsx",
    built.code,
    "```",
  ].join("\n");
  try {
    const run = await runClaude(bin, prompt, { model, kind: "deep" });
    const reply = parseReply(run.text);
    if ("error" in reply) return;
    await push({ type: "edit", summary: reply.summary, code: reply.code, prompt: "Quality check fixes", ...(reply.files ? { files: reply.files } : {}) });
    say(`  Fixed: ${reply.summary.replace(/\s+/g, " ").slice(0, 160)}`);
  } catch (error) {
    say(`  Could not fix automatically: ${error.message}`);
  }
}

/** The board's reference previews (styles and storyboard steps only), as base64 JPEGs. */
async function referenceImages(request) {
  if (request.deliverable === "scene") return [];
  const images = [];
  for (const { file } of boardReferenceFiles(request.board)) {
    try {
      images.push((await readFile(file)).toString("base64"));
    } catch {
      say(`  Reference preview missing: ${file}`);
    }
  }
  return images;
}

async function handleBoardStep(bin, request, model) {
  say(`Storyboard step ${request.id} (${request.action}) for "${request.board.title}"`);
  const images = await referenceImages(request);
  if (images.length) say(`  with ${images.length} reference image(s)`);
  let prompt = request.brief;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let text;
    try {
      const run = await runClaude(bin, prompt, { model, kind: "deep", images });
      text = run.text;
      say(`  Claude answered in ${run.seconds}s`);
    } catch (error) {
      say(`  ${error.message}`);
      await decline(request.id, `Autopilot: ${error.message}`).catch(() => undefined);
      return;
    }
    try {
      const reply = parseJsonObject(text);
      if (typeof reply.error === "string" && reply.error.trim()) {
        await decline(request.id, reply.error.trim());
        say(`  Declined: ${reply.error.trim()}`);
        return;
      }
      const delivered = await deliverBoardStep(request, reply);
      say(`  ${delivered.message}`);
      if (delivered.built) await polishBuiltVideo(bin, model, delivered.built);
      return;
    } catch (error) {
      if (error instanceof BridgeValidationError && attempt === 1) {
        say("  The answer did not pass validation; asking Claude to fix it");
        prompt = `${request.brief}\n\n# Your previous reply\n${text}\n\n# Problem\nIt failed validation: ${error.message}\nReturn the corrected JSON object only.`;
        continue;
      }
      if (error instanceof BridgeError && error.status === 409) {
        // The designer moved on (picked another style, asked for changes) while Claude was working.
        say(`  Skipped: ${error.message}`);
        return;
      }
      const reason = error instanceof Error ? error.message : String(error);
      say(`  Giving up: ${reason}`);
      await decline(request.id, `Autopilot could not complete this storyboard step: ${reason}`).catch(() => undefined);
      return;
    }
  }
}

/** A turn of the New video wizard's conversation: one quick run, a JSON reply posted back. */
async function handleIntake(bin, request, model) {
  say(`Conversation turn ${request.id}`);
  let prompt = request.brief;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let text;
    try {
      const run = await runClaude(bin, prompt, { model, kind: "normal", system: INTAKE_FILE });
      text = run.text;
      say(`  Claude answered in ${run.seconds}s`);
    } catch (error) {
      say(`  ${error.message}`);
      await decline(request.id, `Autopilot: ${error.message}`).catch(() => undefined);
      return;
    }
    try {
      const reply = parseJsonObject(text);
      if (typeof reply.error === "string" && reply.error.trim()) {
        await decline(request.id, reply.error.trim());
        say(`  Declined: ${reply.error.trim()}`);
        return;
      }
      await answerIntake(request.id, reply);
      say(`  ${reply.done ? "Order ready" : "Asked"}: ${String(reply.reply ?? "").replace(/\s+/g, " ").slice(0, 120)}`);
      return;
    } catch (error) {
      if (error instanceof BridgeValidationError && attempt === 1) {
        say("  The reply did not fit; asking Claude to fix it");
        prompt = `${request.brief}\n\n# Your previous reply\n${text}\n\n# Problem\nIt failed validation: ${error.message}\nReturn the corrected JSON object only.`;
        continue;
      }
      if (error instanceof BridgeError && error.status === 409) {
        say("  The designer moved on");
        return;
      }
      const reason = error instanceof Error ? error.message : String(error);
      say(`  Giving up: ${reason}`);
      await decline(request.id, `Autopilot could not answer: ${reason}`).catch(() => undefined);
      return;
    }
  }
}

async function handle(bin, request, model) {
  if (request.kind === "intake") {
    await working("Talking with the designer", () => handleIntake(bin, request, model));
    return;
  }
  if (request.kind === "board") {
    await working(`Storyboard step for "${request.board.title}"`, () => handleBoardStep(bin, request, model));
    return;
  }
  await working(`Request: ${String(request.prompt ?? "").replace(/\s+/g, " ").slice(0, 80)}`, () => handleEdit(bin, request, model));
}

async function handleEdit(bin, request, model) {
  const where = request.layerId ? ` · layer "${request.layerName ?? request.layerId}"` : "";
  say(`Request ${request.id} (${request.scope}${where}): ${request.prompt}`);
  let prompt = request.brief;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let text;
    try {
      const run = await runClaude(bin, prompt, { model, kind: "normal" });
      text = run.text;
      say(`  Claude answered in ${run.seconds}s`);
    } catch (error) {
      say(`  ${error.message}`);
      await decline(request.id, `Autopilot: ${error.message}`).catch(() => undefined);
      return;
    }
    try {
      const reply = parseReply(text);
      if ("error" in reply) {
        await decline(request.id, reply.error);
        say(`  Declined: ${reply.error}`);
        return;
      }
      await answer(request.id, reply);
      say(`  Applied: ${reply.summary.replace(/\s+/g, " ").slice(0, 160)}`);
      return;
    } catch (error) {
      if (error instanceof BridgeValidationError && attempt === 1) {
        say(`  The answer did not pass validation; asking Claude to fix it`);
        prompt = `${request.brief}\n\n# Your previous reply\n${text}\n\n# Problem\nIt failed validation: ${error.message}\nReturn the corrected JSON object only.`;
        continue;
      }
      if (error instanceof BridgeError && error.status === 409) {
        say("  The designer cancelled this request");
        return;
      }
      const reason = error instanceof Error ? error.message : String(error);
      say(`  Giving up: ${reason}`);
      await decline(request.id, `Autopilot could not produce a valid change: ${reason}`).catch(() => undefined);
      return;
    }
  }
}

/** True once the server has been unreachable for SERVER_GONE_MS, for an autopilot the server started. */
function serverGone(since) {
  return MANAGED && since !== null && Date.now() - since > SERVER_GONE_MS;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const model = flags.model ?? process.env.MOTION_STUDIO_AUTOPILOT_MODEL ?? DEFAULT_MODEL;
  // Before anything is reported: a second autopilot must leave the running one's state alone.
  const other = acquireLock();
  if (other) {
    console.log(`Another autopilot is already running (process ${other}); this one exits.`);
    return;
  }
  stateBase.model = model;
  process.once("exit", () => report(exitState.state, exitState.message));
  report("starting");
  setInterval(() => report(current.state, current.message), KEEPALIVE_MS).unref();
  const bin = claudeCommand();
  console.log("WeDo Claude Motion autopilot  ·  اتوپایلوت");
  const found = await resolveBase();
  console.log(`  editor:  ${BASE}${found ? "" : "  (not running yet; waiting for it)"}`);

  const login = checkLogin(bin);
  if (!login.ok) {
    console.log(`\n  ${login.reason}. Sign in once with:  claude auth login\n`);
    exitState = { state: "signed-out", message: login.reason };
    process.exitCode = 2;
    return;
  }
  effortSupported = knowsEffortFlag(bin);
  stateBase.effort = { deep: effortFor("deep") ?? null, normal: effortFor("normal") ?? null };
  console.log(`  claude:  ${bin}  (model ${model}; effort ${effortFor("deep") ?? "default"} for storyboards and builds, ${effortFor("normal") ?? "default"} for edits)`);
  if (!effortSupported) console.log("  This Claude Code has no --effort option; update it (claude update) for the deeper storyboards and builds.");

  WORK_DIR = await mkdtemp(path.join(os.tmpdir(), "wedo-autopilot-"));
  CONTRACT_FILE = path.join(WORK_DIR, "system-prompt.md");
  INTAKE_FILE = path.join(WORK_DIR, "intake-prompt.md");
  await writeFile(INTAKE_FILE, INTAKE_SYSTEM, "utf8");
  const cleanup = () => {
    try {
      rmSync(WORK_DIR, { recursive: true, force: true });
    } catch {
      // Windows may still hold the folder for a moment; the OS temp cleanup removes it later.
    }
  };
  process.once("exit", cleanup);
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.once(signal, () => process.exit(130));
  let unreachableSince = null;
  for (;;) {
    try {
      await writeFile(CONTRACT_FILE, await getContract(), "utf8");
      break;
    } catch (error) {
      if (!(error instanceof BridgeError)) throw error;
      if (unreachableSince === null) {
        say(`${error.message} Waiting…`);
        report("waiting-for-server", error.message);
        unreachableSince = Date.now();
      }
      if (serverGone(unreachableSince)) {
        say("The editor's server did not come up; stopping.");
        return;
      }
      await sleep(3000);
    }
  }
  report("listening");
  say(`Listening. Waiting costs no Claude usage; each request is one Claude Code run. ${MANAGED ? "Stop it in the editor's top bar." : "Ctrl+C stops."}`);

  unreachableSince = null;
  for (;;) {
    let request;
    try {
      request = await claim({ client: "headless" });
      unreachableSince = null;
    } catch (error) {
      if (!(error instanceof BridgeError)) throw error;
      if (error.status === 0) {
        unreachableSince ??= Date.now();
        if (serverGone(unreachableSince)) {
          say("The editor's server has been gone for 10 minutes; stopping.");
          return;
        }
        await sleep(3000);
        continue;
      }
      say(error.message);
      await sleep(5000);
      continue;
    }
    if (!request) {
      await sleep(POLL_MS);
      continue;
    }
    await handle(bin, request, model);
    if (outdated) {
      say(outdated);
      exitState = { state: "needs-update", message: outdated };
      return;
    }
    if (flags.once) return;
  }
}

main().catch((error) => {
  console.error(error);
  exitState = { state: "error", message: error instanceof Error ? error.message : String(error) };
  process.exitCode = 1;
});

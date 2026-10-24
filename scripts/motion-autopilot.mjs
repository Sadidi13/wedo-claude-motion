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
 * Storyboard steps (docs/STORYBOARD.md) are handled the same way: a new video
 * from the editor gets style frames, the designer's choice gets a storyboard,
 * the approval gets the built video, each as one Claude Code run. A built
 * video then goes through the local quality check (docs/QUALITY.md); when it
 * finds real errors, one more run fixes them.
 *
 *   node scripts/motion-autopilot.mjs [--model <alias>] [--once]
 *
 * Environment: MOTION_STUDIO_CLAUDE_BIN (default: `claude` on PATH, then
 * ~/.local/bin/claude.exe), MOTION_STUDIO_AUTOPILOT_MODEL, plus the
 * MOTION_STUDIO_URL / MOTION_STUDIO_BRIDGE_DIR of the bridge client.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BASE,
  BridgeError,
  BridgeValidationError,
  answer,
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

const RUN_TIMEOUT_MS = 10 * 60_000;
const POLL_MS = 1_000;
/** Private, empty working folder (created at start): no project files, CLAUDE.md or settings around Claude Code. */
let WORK_DIR = "";
let CONTRACT_FILE = "";

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

/** The Claude Code executable: MOTION_STUDIO_CLAUDE_BIN, `claude` on PATH, or the native installer's location. */
function claudeCommand() {
  if (process.env.MOTION_STUDIO_CLAUDE_BIN) return process.env.MOTION_STUDIO_CLAUDE_BIN;
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["claude"], { encoding: "utf8" });
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
 * user message holding the text and the images.
 */
function runClaude(bin, prompt, model, images = []) {
  const streaming = images.length > 0;
  // No tools, no MCP servers, no settings/hooks/CLAUDE.md, no saved session: a request can only produce text.
  const args = [
    "-p",
    "--output-format",
    streaming ? "stream-json" : "json",
    ...(streaming ? ["--input-format", "stream-json", "--verbose"] : []),
    "--system-prompt-file",
    CONTRACT_FILE,
    "--tools",
    "",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--no-session-persistence",
  ];
  if (model) args.push("--model", model);
  return new Promise((resolve, reject) => {
    const child = spawnClaude(bin, args, { cwd: WORK_DIR, env: childEnv(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Claude Code did not finish within ${RUN_TIMEOUT_MS / 60_000} minutes`));
    }, RUN_TIMEOUT_MS);
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
        reject(new Error(`Claude Code reported an error: ${String(result.result ?? result.subtype ?? "unknown").slice(0, 400)}`));
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
  return { summary: json.summary, code: json.code, files: files?.length ? files : undefined };
}

/** Deliver one storyboard step from the model's JSON reply; throws BridgeValidationError when it does not fit. */
async function deliverBoardStep(request, reply) {
  if (request.deliverable === "styles") {
    if (!Array.isArray(reply.styles) || reply.styles.length === 0) throw new BridgeValidationError('The reply must have a non-empty "styles" array');
    const board = await proposeStyles({
      boardId: request.boardId,
      ...(typeof reply.title === "string" && reply.title.trim() ? { title: reply.title.trim() } : {}),
      ...(reply.stage && typeof reply.stage === "object" ? { stage: reply.stage } : {}),
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
    const run = await runClaude(bin, prompt, model);
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
      const run = await runClaude(bin, prompt, model, images);
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

async function handle(bin, request, model) {
  if (request.kind === "board") {
    await handleBoardStep(bin, request, model);
    return;
  }
  const where = request.layerId ? ` · layer "${request.layerName ?? request.layerId}"` : "";
  say(`Request ${request.id} (${request.scope}${where}): ${request.prompt}`);
  let prompt = request.brief;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let text;
    try {
      const run = await runClaude(bin, prompt, model);
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

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const model = flags.model ?? process.env.MOTION_STUDIO_AUTOPILOT_MODEL;
  const bin = claudeCommand();
  console.log("WeDo Claude Motion autopilot  ·  اتوپایلوت");
  const found = await resolveBase();
  console.log(`  editor:  ${BASE}${found ? "" : "  (not running yet; waiting for it)"}`);
  console.log(`  claude:  ${bin}${model ? `  (model ${model})` : ""}`);

  const login = checkLogin(bin);
  if (!login.ok) {
    console.log(`\n  ${login.reason}. Sign in once with:  claude auth login\n`);
    process.exitCode = 2;
    return;
  }

  WORK_DIR = await mkdtemp(path.join(os.tmpdir(), "wedo-autopilot-"));
  CONTRACT_FILE = path.join(WORK_DIR, "system-prompt.md");
  const cleanup = () => {
    try {
      rmSync(WORK_DIR, { recursive: true, force: true });
    } catch {
      // Windows may still hold the folder for a moment; the OS temp cleanup removes it later.
    }
  };
  process.once("exit", cleanup);
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.once(signal, () => process.exit(130));
  let warned = false;
  for (;;) {
    try {
      await writeFile(CONTRACT_FILE, await getContract(), "utf8");
      break;
    } catch (error) {
      if (!(error instanceof BridgeError)) throw error;
      if (!warned) say(`${error.message} Waiting…`);
      warned = true;
      await sleep(3000);
    }
  }
  say("Listening. Waiting costs no Claude usage; each request is one short Claude Code run. Ctrl+C stops.");

  for (;;) {
    let request;
    try {
      request = await claim({ client: "headless" });
    } catch (error) {
      if (!(error instanceof BridgeError)) throw error;
      if (error.status === 0) {
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
    if (flags.once) return;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

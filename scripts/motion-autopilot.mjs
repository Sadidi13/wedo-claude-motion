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
 *   node scripts/motion-autopilot.mjs [--model <alias>] [--once]
 *
 * Environment: MOTION_STUDIO_CLAUDE_BIN (default: `claude` on PATH, then
 * ~/.local/bin/claude.exe), MOTION_STUDIO_AUTOPILOT_MODEL, plus the
 * MOTION_STUDIO_URL / MOTION_STUDIO_BRIDGE_DIR of the bridge client.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BASE, BridgeError, BridgeValidationError, answer, claim, decline, getContract, sleep } from "./lib/bridge-client.mjs";

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

/** One `claude -p` run. Resolves with the model's text; rejects with a readable message. */
function runClaude(bin, prompt, model) {
  // No tools, no MCP servers, no settings/hooks/CLAUDE.md, no saved session: a request can only produce text.
  const args = [
    "-p",
    "--output-format",
    "json",
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
        result = JSON.parse(stdout);
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
    child.stdin.end(prompt, "utf8");
  });
}

/** `{ summary, code, files? }` or `{ error }` from the model's reply text. */
function parseReply(text) {
  let body = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(body);
  if (fenced) body = fenced[1].trim();
  if (!body.startsWith("{")) {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) body = body.slice(start, end + 1);
  }
  let json;
  try {
    json = JSON.parse(body);
  } catch (error) {
    throw new BridgeValidationError(`The reply is not a JSON object (${error.message})`);
  }
  if (typeof json?.error === "string" && json.error.trim()) return { error: json.error.trim() };
  if (typeof json?.summary !== "string" || typeof json?.code !== "string") {
    throw new BridgeValidationError('The reply must have string fields "summary" and "code"');
  }
  const files = Array.isArray(json.files) ? json.files.filter((f) => typeof f?.path === "string" && typeof f?.content === "string") : undefined;
  return { summary: json.summary, code: json.code, files: files?.length ? files : undefined };
}

async function handle(bin, request, model) {
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
  console.log("Motion Studio autopilot  ·  اتوپایلوت موشن استودیو");
  console.log(`  editor:  ${BASE}`);
  console.log(`  claude:  ${bin}${model ? `  (model ${model})` : ""}`);

  const login = checkLogin(bin);
  if (!login.ok) {
    console.log(`\n  ${login.reason}. Sign in once with:  claude auth login\n`);
    process.exitCode = 2;
    return;
  }

  WORK_DIR = await mkdtemp(path.join(os.tmpdir(), "wedo-autopilot-"));
  CONTRACT_FILE = path.join(WORK_DIR, "system-prompt.md");
  const cleanup = () => rmSync(WORK_DIR, { recursive: true, force: true });
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

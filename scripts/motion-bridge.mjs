#!/usr/bin/env node
/**
 * motion-bridge — the Claude side of the Claude Desktop ⇄ Motion Studio bridge
 * (docs/CLAUDE-DESKTOP.md). No dependencies; talks to the running dev server.
 *
 *   status                         is the server up, is anyone listening, what is open
 *   contract                       write the authoring contract to .motion-bridge/contract.md
 *   project                        write the open project to .motion-bridge/project/
 *   wait                           block until the editor queues a request, claim it,
 *                                  write its brief to .motion-bridge/requests/<id>/ and exit
 *   respond <id> --summary <text> --code <file> [--file <path>=<local>]...
 *                                  answer a claimed request (validated before the editor sees it)
 *   fail <id> <reason>             decline a request
 *   new <scene.jsx> --name <name> --summary <text> [--file <path>=<local>]...
 *                                  open a new layered scene in the editor
 *   edit <scene.jsx|element.jsx> --summary <text> [--prompt <text>] [--layer <id>] [--file ...]
 *                                  change the open project (whole entry file, or one layer)
 *
 * Environment: MOTION_STUDIO_URL (default http://localhost:3000),
 * MOTION_STUDIO_BRIDGE_DIR (must match the server's; default <tmp>/motion-studio/bridge).
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.env.MOTION_STUDIO_URL || "http://localhost:3000").replace(/\/+$/, "");
const BRIDGE_DIR = process.env.MOTION_STUDIO_BRIDGE_DIR || path.join(os.tmpdir(), "motion-studio", "bridge");
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(REPO, ".motion-bridge");
const TOKEN_HEADER = "x-motion-bridge-token";

class CliError extends Error {}

function parseArgs(argv) {
  const positional = [];
  const flags = { file: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [key, inline] = arg.slice(2).split(/=(.*)/s, 2);
    const value = inline ?? argv[++i];
    if (value === undefined) throw new CliError(`--${key} needs a value`);
    if (key === "file") flags.file.push(value);
    else flags[key] = value;
  }
  return { positional, flags };
}

async function readToken() {
  try {
    return (await readFile(path.join(BRIDGE_DIR, "token"), "utf8")).trim();
  } catch {
    return null;
  }
}

async function request(method, route, { body, auth = false } = {}) {
  const send = async (token) => {
    const headers = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token) headers[TOKEN_HEADER] = token;
    let response;
    try {
      response = await fetch(`${BASE}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (error) {
      throw new CliError(`Motion Studio is not reachable at ${BASE} (${error.cause?.code ?? error.message}). Start it with "pnpm dev".`);
    }
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json, text };
  };
  let token = auth ? await readToken() : null;
  let result = await send(token);
  // The server creates the token on first use; read it and try once more.
  if (auth && result.status === 401) {
    token = await readToken();
    if (!token) {
      throw new CliError(`No bridge token in ${BRIDGE_DIR}. The server and this script must share MOTION_STUDIO_BRIDGE_DIR.`);
    }
    result = await send(token);
  }
  return result;
}

function fail(result, what) {
  const detail = result.json?.error ?? result.text ?? "";
  throw new CliError(`${what} failed (HTTP ${result.status})${detail ? `: ${detail}` : ""}`);
}

async function readLocal(file) {
  try {
    return await readFile(path.resolve(file), "utf8");
  } catch (error) {
    throw new CliError(`Cannot read ${file}: ${error.message}`);
  }
}

async function extraFiles(specs) {
  const files = [];
  for (const spec of specs) {
    const at = spec.indexOf("=");
    if (at <= 0) throw new CliError(`--file expects <project path>=<local file>, got "${spec}"`);
    files.push({ path: spec.slice(0, at), content: await readLocal(spec.slice(at + 1)) });
  }
  return files.length ? files : undefined;
}

function need(value, message) {
  if (value === undefined || value === "") throw new CliError(message);
  return value;
}

async function writeOut(relative, content) {
  const file = path.join(OUT, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
  return file;
}

// ---------------------------------------------------------------------------

async function cmdStatus() {
  const result = await request("GET", "/api/bridge/status");
  if (result.status !== 200) fail(result, "status");
  const s = result.json;
  console.log(`server:    ${BASE} (up)`);
  console.log(`listener:  ${s.listener}${s.lastSeen ? ` (last poll ${Math.round((Date.now() - s.lastSeen) / 1000)}s ago)` : ""}`);
  console.log(`queued:    ${s.pending} request(s)`);
  console.log(`open:      ${s.project ? `"${s.project.name}" (${s.project.id}), shared ${s.project.syncedAt}` : "nothing shared yet (open the editor in a browser)"}`);
}

async function cmdContract() {
  const result = await request("GET", "/api/bridge/contract");
  if (result.status !== 200) fail(result, "contract");
  const file = await writeOut("contract.md", result.text);
  console.log(`contract written to ${file}`);
}

async function cmdProject() {
  const result = await request("GET", "/api/bridge/project", { auth: true });
  if (result.status !== 200) fail(result, "project");
  const { project, syncedAt } = result.json;
  const dir = path.join(OUT, "project");
  await rm(dir, { recursive: true, force: true });
  const skipped = [];
  for (const file of Object.values(project.files)) {
    if (file.kind === "asset") skipped.push(file.path);
    else await writeOut(path.join("project", file.path), file.content);
  }
  await writeOut(path.join("project", "_project.json"), JSON.stringify({ ...project, files: Object.keys(project.files) }, null, 2));
  const m = project.meta;
  console.log(`project:   "${project.name}" (${project.id}), shared ${syncedAt}`);
  console.log(`stage:     ${m.width}x${m.height}, ${m.duration}s @ ${m.fps}fps, background ${m.background ?? "transparent"}`);
  console.log(`entry:     ${path.join(dir, project.entry)}`);
  console.log(`files in:  ${dir}`);
  if (skipped.length) console.log(`assets (not written): ${skipped.join(", ")}`);
}

async function cmdWait(flags) {
  const interval = Number(flags.interval ?? 1000);
  let warned = false;
  for (;;) {
    let result;
    try {
      result = await request("POST", "/api/bridge/claim", { auth: true });
    } catch (error) {
      if (!(error instanceof CliError)) throw error;
      if (!warned) console.error(`${error.message} Retrying…`);
      warned = true;
      await new Promise((resolve) => setTimeout(resolve, 3000));
      continue;
    }
    if (result.status === 204) {
      await new Promise((resolve) => setTimeout(resolve, interval));
      continue;
    }
    if (result.status !== 200) fail(result, "claim");
    const r = result.json;
    const dir = path.join("requests", r.id);
    const brief = await writeOut(path.join(dir, "brief.md"), r.brief);
    for (const file of r.files) await writeOut(path.join(dir, "files", file.path), file.content);
    console.log(`MOTION_STUDIO_REQUEST ${r.id}`);
    console.log(`scope:   ${r.scope}${r.layerId ? `  layer: ${r.layerId}${r.layerName ? ` "${r.layerName}"` : ""}` : ""}`);
    console.log(`project: "${r.project.name}" (${r.project.id})`);
    console.log(`prompt:  ${r.prompt}`);
    console.log(`brief:   ${brief}`);
    console.log(`files:   ${path.join(OUT, dir, "files")}`);
    console.log(`answer:  node scripts/motion-bridge.mjs respond ${r.id} --summary "..." --code <file>`);
    return;
  }
}

async function cmdRespond(positional, flags) {
  const id = need(positional[0], "respond <id> --summary <text> --code <file>");
  const body = {
    summary: need(flags.summary, "--summary is required"),
    code: await readLocal(need(flags.code, "--code <file> is required")),
    files: await extraFiles(flags.file),
  };
  const result = await request("POST", `/api/bridge/requests/${encodeURIComponent(id)}/result`, { body, auth: true });
  if (result.status === 422) {
    throw new CliError(`The answer did not pass validation, fix it and respond again:\n${result.json?.error ?? result.text}`);
  }
  if (result.status !== 200) fail(result, "respond");
  console.log(`OK: request ${id} answered; the editor applies it within a second.`);
}

async function cmdFail(positional) {
  const id = need(positional[0], "fail <id> <reason>");
  const reason = need(positional.slice(1).join(" "), "fail <id> <reason>");
  const result = await request("POST", `/api/bridge/requests/${encodeURIComponent(id)}/result`, { body: { error: reason }, auth: true });
  if (result.status !== 200) fail(result, "fail");
  console.log(`OK: request ${id} declined.`);
}

async function push(body) {
  const result = await request("POST", "/api/bridge/events", { body, auth: true });
  if (result.status === 422) {
    throw new CliError(`The code did not pass validation, fix it and push again:\n${result.json?.error ?? result.text}`);
  }
  if (result.status !== 201) fail(result, body.type === "project" ? "new" : "edit");
  return result.json;
}

async function cmdNew(positional, flags) {
  const file = need(positional[0], "new <scene.jsx> --name <name> --summary <text>");
  const json = await push({
    type: "project",
    name: need(flags.name, "--name is required"),
    summary: need(flags.summary, "--summary is required"),
    code: await readLocal(file),
    files: await extraFiles(flags.file),
  });
  console.log(`OK: new scene queued for the editor (${json.layers} top-level layers, project ${json.projectId}).`);
}

async function cmdEdit(positional, flags) {
  const file = need(positional[0], "edit <file> --summary <text> [--prompt <text>] [--layer <id>]");
  const json = await push({
    type: "edit",
    summary: need(flags.summary, "--summary is required"),
    prompt: flags.prompt ?? "",
    ...(flags.layer ? { layerId: flags.layer } : {}),
    code: await readLocal(file),
    files: await extraFiles(flags.file),
  });
  console.log(`OK: edit queued for project ${json.projectId}; the editor applies it within a second (one Undo reverts it).`);
}

const COMMANDS = { status: cmdStatus, contract: cmdContract, project: cmdProject, wait: cmdWait, respond: cmdRespond, fail: cmdFail, new: cmdNew, edit: cmdEdit };

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const handler = COMMANDS[command];
  if (!handler) {
    console.log("usage: node scripts/motion-bridge.mjs <status|contract|project|wait|respond|fail|new|edit> …");
    process.exitCode = command ? 2 : 0;
    return;
  }
  const { positional, flags } = parseArgs(rest);
  await handler(command === "wait" || command === "status" || command === "contract" || command === "project" ? flags : positional, flags);
}

main().catch((error) => {
  console.error(error instanceof CliError ? error.message : error);
  process.exitCode = 1;
});

#!/usr/bin/env node
/**
 * motion-bridge — the Claude side of the Motion Studio bridge, for Claude Code
 * sessions (the Claude desktop app's Code tab). The regular Claude chat uses the
 * MCP connector in scripts/motion-studio-mcp.mjs instead (`install-chat` sets it up).
 * Design: docs/CLAUDE-DESKTOP.md. No dependencies.
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
 *   install-chat [--config <claude_desktop_config.json>]
 *                                  register the MCP connector in Claude Desktop (backs the file up)
 */
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BASE,
  BridgeError,
  BridgeValidationError,
  REPO,
  SCRATCH,
  answer,
  claim,
  decline,
  getContract,
  getProject,
  getStatus,
  push,
  sleep,
} from "./lib/bridge-client.mjs";

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
  const file = path.join(SCRATCH, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
  return file;
}

// ---------------------------------------------------------------------------

async function cmdStatus() {
  const s = await getStatus();
  console.log(`server:    ${BASE} (up)`);
  console.log(`listener:  ${s.listener}${s.lastSeen ? ` (last poll ${Math.round((Date.now() - s.lastSeen) / 1000)}s ago)` : ""}`);
  console.log(`queued:    ${s.pending} request(s)`);
  console.log(`open:      ${s.project ? `"${s.project.name}" (${s.project.id}), shared ${s.project.syncedAt}` : "nothing shared yet (open the editor in a browser)"}`);
}

async function cmdContract() {
  const file = await writeOut("contract.md", await getContract());
  console.log(`contract written to ${file}`);
}

async function cmdProject() {
  const { project, syncedAt } = await getProject();
  const dir = path.join(SCRATCH, "project");
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
    let r;
    try {
      r = await claim();
    } catch (error) {
      if (!(error instanceof BridgeError) || error.status !== 0) throw error;
      if (!warned) console.error(`${error.message} Retrying…`);
      warned = true;
      await sleep(3000);
      continue;
    }
    if (!r) {
      await sleep(interval);
      continue;
    }
    const dir = path.join("requests", r.id);
    const brief = await writeOut(path.join(dir, "brief.md"), r.brief);
    for (const file of r.files) await writeOut(path.join(dir, "files", file.path), file.content);
    console.log(`MOTION_STUDIO_REQUEST ${r.id}`);
    console.log(`scope:   ${r.scope}${r.layerId ? `  layer: ${r.layerId}${r.layerName ? ` "${r.layerName}"` : ""}` : ""}`);
    console.log(`project: "${r.project.name}" (${r.project.id})`);
    console.log(`prompt:  ${r.prompt}`);
    console.log(`brief:   ${brief}`);
    console.log(`files:   ${path.join(SCRATCH, dir, "files")}`);
    console.log(`answer:  node scripts/motion-bridge.mjs respond ${r.id} --summary "..." --code <file>`);
    return;
  }
}

async function cmdRespond(positional, flags) {
  const id = need(positional[0], "respond <id> --summary <text> --code <file>");
  await answer(id, {
    summary: need(flags.summary, "--summary is required"),
    code: await readLocal(need(flags.code, "--code <file> is required")),
    files: await extraFiles(flags.file),
  });
  console.log(`OK: request ${id} answered; the editor applies it within a second.`);
}

async function cmdFail(positional) {
  const id = need(positional[0], "fail <id> <reason>");
  await decline(id, need(positional.slice(1).join(" "), "fail <id> <reason>"));
  console.log(`OK: request ${id} declined.`);
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

/** Existing Claude Desktop config files, most recently written first. */
async function findClaudeDesktopConfigs() {
  const home = os.homedir();
  const candidates = [];
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    const roaming = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    for (const [root, nested] of [
      [path.join(local, "Claude-Data"), ""],
      [path.join(local, "Packages"), path.join("LocalCache", "Roaming", "Claude")],
    ]) {
      const entries = await readdir(root).catch(() => []);
      for (const name of entries) {
        if (/^claude[_-]/i.test(name)) candidates.push(path.join(root, name, nested, "claude_desktop_config.json"));
      }
    }
    candidates.push(path.join(roaming, "Claude", "claude_desktop_config.json"));
  } else if (process.platform === "darwin") {
    candidates.push(path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"));
  } else {
    candidates.push(path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "Claude", "claude_desktop_config.json"));
  }
  const found = [];
  for (const file of candidates) {
    const info = await stat(file).catch(() => null);
    if (info?.isFile()) found.push({ file, mtime: info.mtimeMs });
  }
  found.sort((a, b) => b.mtime - a.mtime);
  return { found: found.map((f) => f.file), fallback: candidates.at(-1) };
}

async function cmdInstallChat(flags) {
  const { found, fallback } = await findClaudeDesktopConfigs();
  const file = flags.config ? path.resolve(flags.config) : (found[0] ?? fallback);
  let config = {};
  const existing = await readFile(file, "utf8").catch(() => null);
  if (existing !== null) {
    try {
      config = JSON.parse(existing);
    } catch (error) {
      throw new CliError(`${file} is not valid JSON (${error.message}); fix it first, nothing was changed.`);
    }
    const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await copyFile(file, backup);
    console.log(`backup:    ${backup}`);
  } else {
    await mkdir(path.dirname(file), { recursive: true });
  }
  const server = { command: process.execPath, args: [path.join(REPO, "scripts", "motion-studio-mcp.mjs")] };
  config.mcpServers = { ...(config.mcpServers ?? {}), "motion-studio": server };
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  console.log(`config:    ${file}`);
  console.log(`connector: motion-studio → ${server.command} ${server.args[0]}`);
  if (found.length > 1) console.log(`other configs left unchanged: ${found.slice(1).join(", ")}`);
  console.log("Quit Claude Desktop completely (tray icon → Quit) and open it again to load the connector.");
}

const COMMANDS = {
  status: () => cmdStatus(),
  contract: () => cmdContract(),
  project: () => cmdProject(),
  wait: (_positional, flags) => cmdWait(flags),
  respond: cmdRespond,
  fail: (positional) => cmdFail(positional),
  new: cmdNew,
  edit: cmdEdit,
  "install-chat": (_positional, flags) => cmdInstallChat(flags),
};

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const handler = COMMANDS[command];
  if (!handler) {
    console.log(`usage: node scripts/motion-bridge.mjs <${Object.keys(COMMANDS).join("|")}> …`);
    process.exitCode = command ? 2 : 0;
    return;
  }
  const { positional, flags } = parseArgs(rest);
  await handler(positional, flags);
}

main().catch((error) => {
  if (error instanceof BridgeValidationError) {
    console.error(`The code did not pass validation. Fix it and run the command again:\n${error.message}`);
  } else if (error instanceof CliError || error instanceof BridgeError) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

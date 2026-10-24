#!/usr/bin/env node
/**
 * motion-bridge — the Claude side of the Motion Studio bridge, for Claude Code
 * sessions (the Claude desktop app's Code tab). The regular Claude chat uses the
 * MCP connector in scripts/motion-studio-mcp.mjs instead (`install-chat` sets it up).
 * Design: docs/CLAUDE-DESKTOP.md. No dependencies.
 *
 *   start [--no-open] [--wait <s>] start the editor's server if needed and open the editor
 *   open [--wait <s>]              open the editor in the browser (waiting for a starting server)
 *   status                         is the server up, is anyone listening, what is open
 *   contract                       write the authoring contract to .motion-bridge/contract.md
 *   project                        write the open project to .motion-bridge/project/
 *   wait                           block until the editor queues a request, claim it,
 *                                  write its brief to .motion-bridge/requests/<id>/ and exit
 *   respond <id> --summary <text> --code <file> [--file <path>=<local>]...
 *                                  answer a claimed request (validated before the editor sees it)
 *   fail <id> <reason>             decline a request
 *   new <scene.jsx> --name <name> --summary <text> --board <id> [--file <path>=<local>]...
 *                                  build the video of an approved storyboard as a new layered project
 *                                  (--skip-storyboard instead of --board only when the user asked for no storyboard)
 *   board-styles <styles.json> [--board <id>]
 *                                  propose style frames (a new storyboard, or the one the editor started)
 *   board-storyboard <id> <storyboard.json>
 *                                  propose the storyboard in the chosen style
 *   board [<id>]                   show a storyboard (default: the newest) and write its material to
 *                                  .motion-bridge/boards/<id>/
 *   board-choose <id> <style> [--note <text>] | board-restyle <id> [--note <text>] |
 *   board-revise <id> --note <text> | board-approve <id> [--note <text>]
 *                                  record a decision the designer told you in the chat
 *   qa [--event <id>]              quality check of the last scene / edit you sent (or the open project): renders it
 *                                  locally and lists cut-off, overlapping or hard-to-read text, empty or frozen stretches
 *   styles                         write the style library (directions + recipes) to .motion-bridge/style-library.md
 *   reference <image|video>        make a preview / contact sheet of a reference file in .motion-bridge/refs/
 *   edit <scene.jsx|element.jsx> --summary <text> [--prompt <text>] [--layer <id>] [--file ...]
 *                                  change the open project (whole entry file, or one layer)
 *   install-chat [--config <claude_desktop_config.json>] [--force]
 *                                  register the MCP connector in Claude Desktop (backs the file up).
 *                                  Claude Desktop must be closed: it overwrites the file while running.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import {
  BASE,
  BOARD_NEXT_STEP,
  BridgeError,
  BridgeValidationError,
  NEXT_STEP_NOTE,
  REPO,
  SCRATCH,
  answer,
  checkQuality,
  claim,
  decline,
  describeBoard,
  editorUrl,
  ensureServer,
  getBoard,
  getContract,
  getProject,
  getStatus,
  getStyleLibrary,
  listBoards,
  proposeStoryboard,
  proposeStyles,
  push,
  openInBrowser,
  recordBoardDecision,
  showBoard,
  showInEditor,
  sleep,
  tryStatus,
} from "./lib/bridge-client.mjs";

class CliError extends Error {}

/** Flags that take no value. */
const BOOLEAN_FLAGS = new Set(["force", "no-open", "skip-storyboard"]);

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
    if (BOOLEAN_FLAGS.has(key) && inline === undefined) {
      flags[key] = true;
      continue;
    }
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

/**
 * Write `relative` inside SCRATCH/`folder`, refusing any path that would land outside that folder.
 * Project file paths come from the editor (and so, potentially, from an imported project): the
 * server rejects unsafe ones, and this check makes sure a path can never escape here either.
 */
async function writeInside(folder, relative, content) {
  const root = path.resolve(SCRATCH, folder);
  const file = path.resolve(root, relative);
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new CliError(`Refusing to write "${relative}": it is outside ${root}`);
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
  return file;
}

const writeOut = (relative, content) => writeInside(".", relative, content);

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
    else await writeInside("project", file.path, file.content);
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
    if (!/^[0-9a-z]{15}$/.test(r.id)) throw new CliError(`Unexpected request id "${r.id}"`);
    if (r.kind === "board") {
      await printBoardStep(r);
      return;
    }
    const dir = path.join("requests", r.id);
    const brief = await writeOut(path.join(dir, "brief.md"), r.brief);
    for (const file of r.files) await writeInside(path.join(dir, "files"), file.path, file.content);
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

/** A storyboard step from the editor: brief + board material on disk, then what to run. */
async function printBoardStep(r) {
  if (!/^[0-9a-z]{15}$/.test(r.boardId)) throw new CliError(`Unexpected board id "${r.boardId}"`);
  const brief = await writeOut(path.join("requests", r.id, "brief.md"), r.brief);
  const material = await writeBoardMaterial(r.board);
  console.log(`MOTION_STUDIO_BOARD_STEP ${r.id}`);
  console.log(`board:   "${r.board.title}" (${r.boardId})`);
  console.log(`step:    ${r.action} -> deliver ${r.deliverable}`);
  console.log(`brief:   ${brief}`);
  console.log(`files:   ${material}`);
  console.log("Read the brief: it says exactly which command delivers this step.");
}

/** Style frames, the chosen style and storyboard sketches of a board, written to .motion-bridge/boards/<id>/. */
async function writeBoardMaterial(board) {
  const folder = path.join("boards", board.id);
  const chosen = board.styles.find((style) => style.id === board.chosenStyleId);
  for (const style of board.styles) await writeInside(folder, `style-${style.id}.jsx`, style.code);
  if (chosen) {
    await writeInside(folder, "chosen-style.jsx", chosen.code);
    for (const file of chosen.files ?? []) await writeInside(path.join(folder, "chosen-style-files"), file.path, file.content);
  }
  for (const shot of board.shots) if (shot.code) await writeInside(folder, `sketch-${shot.id}.jsx`, shot.code);
  await writeInside(folder, "board.json", JSON.stringify(board, null, 2));
  return path.join(SCRATCH, folder);
}

/**
 * Read a JSON manifest. Each item's `code` may be a path relative to the manifest (or the code itself),
 * and `files` an object of { "<project path>": "<local file>" }; both are replaced by their content.
 */
async function readManifest(file) {
  let manifest;
  try {
    manifest = JSON.parse(await readLocal(file));
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`${file} is not valid JSON: ${error.message}`);
  }
  const base = path.dirname(path.resolve(file));
  const resolveItem = async (item, label) => {
    if (typeof item?.code !== "string") return item;
    const trimmed = item.code.trim();
    const looksLikePath = /\.(jsx|tsx|js|ts)$/i.test(trimmed) && !trimmed.includes("\n");
    const code = looksLikePath ? await readLocal(path.resolve(base, trimmed)) : item.code;
    if (!code.trim()) throw new CliError(`${label}: code is empty`);
    let files;
    if (item.files && typeof item.files === "object" && !Array.isArray(item.files)) {
      files = [];
      for (const [projectPath, local] of Object.entries(item.files)) {
        files.push({ path: projectPath, content: await readLocal(path.resolve(base, String(local))) });
      }
    } else if (Array.isArray(item.files)) {
      files = item.files;
    }
    const { files: _files, ...rest } = item;
    void _files;
    return { ...rest, code, ...(files?.length ? { files } : {}) };
  };
  if (Array.isArray(manifest.styles)) {
    manifest.styles = await Promise.all(manifest.styles.map((style, i) => resolveItem(style, `style ${i + 1}`)));
  }
  if (Array.isArray(manifest.shots)) {
    manifest.shots = await Promise.all(manifest.shots.map((shot, i) => resolveItem(shot, `shot ${i + 1}`)));
  }
  return manifest;
}

async function cmdBoardStyles(positional, flags) {
  const file = need(positional[0], "board-styles <styles.json> [--board <id>]");
  const manifest = await readManifest(file);
  const { started } = await ensureServer();
  if (started) console.log(`Started the dev server in ${REPO}.`);
  const title = flags.title ?? manifest.title;
  const brief = flags.brief ?? manifest.brief;
  const board = await proposeStyles({
    ...(flags.board ? { boardId: flags.board } : {}),
    ...(title ? { title } : {}),
    ...(brief ? { brief } : {}),
    ...(manifest.stage ? { stage: manifest.stage } : {}),
    styles: manifest.styles,
  });
  const opened = await showBoard(board.id);
  console.log(`OK: ${board.styles.length} style frames on board ${board.id}; ${opened ? "opened the storyboard in the browser" : "the open editor shows them"}.`);
  console.log(describeBoard(board));
  console.log("");
  console.log("The designer picks a style in the storyboard view (or tells you here). Their choice arrives as a");
  console.log("storyboard step through `wait`; if they tell you in the chat, record it with board-choose and continue.");
  printBoardNote("styles");
}

async function cmdBoardStoryboard(positional) {
  const usage = "board-storyboard <id> <storyboard.json>";
  const id = need(positional[0], usage);
  const manifest = await readManifest(need(positional[1], usage));
  const board = await proposeStoryboard(id, { notes: manifest.notes ?? "", shots: manifest.shots });
  const opened = await showBoard(board.id);
  console.log(`OK: storyboard with ${board.shots.length} shots on board ${board.id}; ${opened ? "opened it in the browser" : "the open editor shows it"}.`);
  console.log("");
  console.log("The designer approves it in the storyboard view or asks for changes (or tells you here). Their");
  console.log("decision arrives as a storyboard step through `wait`. Build only after the approval.");
  printBoardNote("storyboard");
}

async function cmdBoard(positional) {
  let id = positional[0];
  if (!id) {
    const [latest] = await listBoards();
    if (!latest) throw new CliError("There is no storyboard yet.");
    id = latest.id;
  }
  const board = await getBoard(id);
  const folder = await writeBoardMaterial(board);
  console.log(describeBoard(board));
  console.log(`material:  ${folder}`);
}

const DECISIONS = { choose: "choose-style", restyle: "restyle", revise: "revise-storyboard", approve: "approve" };

function decisionCommand(kind) {
  return async (positional, flags) => {
    const id = need(positional[0], `board-${kind} <id> ...`);
    const body = { action: DECISIONS[kind] };
    if (kind === "choose") body.styleId = need(positional[1], "board-choose <id> <style id> [--note <text>]");
    if (kind === "revise") body.note = need(flags.note, "board-revise <id> --note <what to change>");
    else if (flags.note) body.note = flags.note;
    const board = await recordBoardDecision(id, body);
    await writeBoardMaterial(board);
    console.log(`OK: recorded.\n${describeBoard(board)}`);
  };
}

async function cmdQa(flags) {
  let eventId = flags.event;
  if (!eventId) {
    try {
      const last = JSON.parse(await readFile(path.join(SCRATCH, LAST_EVENT_FILE), "utf8"));
      if (Date.now() - last.at < 30 * 60_000) eventId = last.eventId;
    } catch {
      // nothing pushed yet: check the open project
    }
  }
  console.log("Rendering the scene locally and checking it (a few seconds to a minute)...");
  const { text } = await checkQuality(eventId);
  console.log(text);
}

async function cmdStyles() {
  const file = await writeOut("style-library.md", await getStyleLibrary());
  console.log(`style library written to ${file}`);
}

/** ffmpeg for local reference sheets: FFMPEG_PATH, the app's ffmpeg-static, or ffmpeg on PATH. */
function ffmpegBinary() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const bundled = createRequire(path.join(REPO, "package.json"))("ffmpeg-static");
    if (bundled && existsSync(bundled)) return bundled;
  } catch {
    // not installed: fall back to PATH
  }
  return "ffmpeg";
}

function runQuiet(binary, args) {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr = (stderr + chunk).slice(-20_000)));
    child.on("error", (error) => resolve({ code: -1, stderr: error.message }));
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

/**
 * A reference the user points to on disk: an image is scaled to 1280 px, a video becomes a contact
 * sheet of 12 (or 16) evenly spaced frames. Written to .motion-bridge/refs/ for the Read tool.
 */
async function cmdReference(positional) {
  const input = path.resolve(need(positional[0], "reference <image or video file>"));
  const info = await stat(input).catch(() => null);
  if (!info?.isFile()) throw new CliError(`${input} is not a file`);
  const ext = path.extname(input).slice(1).toLowerCase();
  const video = ["mp4", "mov", "webm", "m4v", "mkv", "avi"].includes(ext);
  if (!video && !["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(ext)) throw new CliError("Give an image or a video file");
  const slug = path.basename(input, path.extname(input)).replace(/[^\w.-]+/g, "-").slice(0, 60) || "reference";
  const output = path.join(SCRATCH, "refs", `${slug}.${video ? "sheet" : "preview"}.jpg`);
  await mkdir(path.dirname(output), { recursive: true });
  const ffmpeg = ffmpegBinary();
  if (!video) {
    const run = await runQuiet(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-i", input, "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-q:v", "3", output]);
    if (run.code !== 0) throw new CliError(`ffmpeg could not read the image: ${run.stderr.trim().split("\n").pop()}`);
    console.log(`reference: ${output}\nOpen it with the Read tool.`);
    return;
  }
  const probe = await runQuiet(ffmpeg, ["-hide_banner", "-i", input]);
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(probe.stderr);
  const duration = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
  if (!duration) throw new CliError("ffmpeg could not read the video's duration");
  const rows = duration > 20 ? 4 : 3;
  const count = 4 * rows;
  const times = Array.from({ length: count }, (_, i) => Number((((i + 0.5) * duration) / count).toFixed(2)));
  const run = await runQuiet(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error", "-i", input,
    "-vf", `fps=${(count / duration).toFixed(6)},scale=400:-2,tile=4x${rows}:padding=4:color=black`,
    "-frames:v", "1", "-q:v", "3", output,
  ]);
  if (run.code !== 0) throw new CliError(`ffmpeg could not make the contact sheet: ${run.stderr.trim().split("\n").pop()}`);
  console.log(`reference: ${output}`);
  console.log(`video:     ${duration.toFixed(2)}s, ${count} frames left to right, top to bottom, at ${times.join("s, ")}s`);
  console.log("Open it with the Read tool.");
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

const LAST_EVENT_FILE = "last-event.json";

/** Start the server when needed, push, open the editor in the browser if no tab is open, print the next-step note. */
async function pushAndShow(body) {
  const { started } = await ensureServer();
  if (started) console.log(`Started the dev server in ${REPO}.`);
  const json = await push(body);
  // `qa` checks this scene / edit next (the editor may still be loading it).
  await writeOut(LAST_EVENT_FILE, JSON.stringify({ eventId: json.eventId, at: Date.now() }));
  const opened = await showInEditor(json.eventId);
  return { json, where: opened ? "opened the editor in the browser" : "the open editor tab applies it within two seconds" };
}

function printBoardNote(step) {
  console.log("\nEnd your reply to the user with this note, in their language:");
  console.log(`FA: ${BOARD_NEXT_STEP[step].fa}`);
  console.log(`EN: ${BOARD_NEXT_STEP[step].en}`);
}

function printNextStepNote() {
  console.log("\nEnd your reply to the user with this note, in their language:");
  console.log(`FA: ${NEXT_STEP_NOTE.fa}`);
  console.log(`EN: ${NEXT_STEP_NOTE.en}`);
}

async function cmdNew(positional, flags) {
  const file = need(positional[0], "new <scene.jsx> --name <name> --summary <text> --board <id>");
  if (!flags.board && !flags["skip-storyboard"]) {
    throw new CliError(
      "New videos start with a storyboard: propose style frames with board-styles, wait for the designer's choice and approval, " +
        "then run new ... --board <id>. Use --skip-storyboard only when the user explicitly asked for no storyboard.",
    );
  }
  const { json, where } = await pushAndShow({
    type: "project",
    name: need(flags.name, "--name is required"),
    summary: need(flags.summary, "--summary is required"),
    code: await readLocal(file),
    files: await extraFiles(flags.file),
    ...(flags.board ? { boardId: flags.board } : { skipStoryboard: true }),
  });
  console.log(`OK: new scene created (${json.layers} top-level layers, project ${json.projectId}); ${where}.`);
  printNextStepNote();
}

async function cmdEdit(positional, flags) {
  const file = need(positional[0], "edit <file> --summary <text> [--prompt <text>] [--layer <id>]");
  const { json, where } = await pushAndShow({
    type: "edit",
    summary: need(flags.summary, "--summary is required"),
    prompt: flags.prompt ?? "",
    ...(flags.layer ? { layerId: flags.layer } : {}),
    code: await readLocal(file),
    files: await extraFiles(flags.file),
  });
  console.log(`OK: edit sent to project ${json.projectId}; ${where} (one Undo reverts it).`);
  printNextStepNote();
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

/**
 * Is the Claude desktop app running? It keeps its config in memory and writes it back when it saves
 * its own settings, which would drop a connector added meanwhile. (Claude Code sessions, including
 * this one when run from the app, live elsewhere and do not count.)
 */
function claudeDesktopRunning() {
  try {
    if (process.platform === "win32") {
      // Store build: ...\WindowsApps\Claude_<version>\app\claude.exe; installer build: ...\AnthropicClaude\...
      const script =
        "@(Get-Process claude -ErrorAction SilentlyContinue | Where-Object { " +
        "$_.Path -like '*\\WindowsApps\\Claude_*' -or $_.Path -like '*\\AnthropicClaude\\*' }).Count";
      const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return Number(output.trim()) > 0;
    }
    if (process.platform === "darwin") {
      execFileSync("pgrep", ["-x", "Claude"], { stdio: "ignore" });
      return true;
    }
  } catch {
    return false; // pgrep exits 1 when nothing matches; any other failure: do not block
  }
  return false;
}

async function cmdInstallChat(flags) {
  if (!flags.force && claudeDesktopRunning()) {
    throw new CliError(
      "Claude Desktop is running, and it overwrites its config file when it saves its own settings, so the " +
        "connector would be lost. Quit it completely first (tray icon, then Quit) and run this again, or " +
        "double-click scripts/connect-claude-chat.cmd, which waits for that. --force writes anyway.",
    );
  }
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
  console.log("Open Claude Desktop now; the connector loads when it starts.");
}

/**
 * Remember where this app lives (~/.wedo-claude-motion/location), so the Claude Code plugin's skill
 * finds it from any folder. Best effort.
 */
async function recordLocation() {
  try {
    const dir = path.join(os.homedir(), ".wedo-claude-motion");
    const file = path.join(dir, "location");
    const current = await readFile(file, "utf8").catch(() => "");
    if (current.trim() === REPO) return;
    await mkdir(dir, { recursive: true });
    await writeFile(file, `${REPO}\n`, "utf8");
  } catch {
    // not essential
  }
}

/** Start the editor's server when it is not running, then open the editor (unless --no-open). */
async function cmdStart(flags) {
  await recordLocation();
  const { status, started } = await ensureServer({ timeoutSeconds: Number(flags.wait ?? 180) });
  console.log(started ? `Started WeDo Claude Motion at ${BASE}.` : `WeDo Claude Motion is running at ${BASE}.`);
  if (!flags["no-open"] && !status.editorOpen) {
    openInBrowser(editorUrl(undefined, { lead: true }));
    console.log("Opened the editor in your browser.");
  }
}

/** Open the editor in the browser; with --wait <seconds>, wait for a server that is still starting. */
async function cmdOpen(flags) {
  await recordLocation();
  const deadline = Date.now() + Number(flags.wait ?? 0) * 1000;
  let status = await tryStatus();
  while (!status && Date.now() < deadline) {
    await sleep(1500);
    status = await tryStatus();
  }
  if (!status) throw new CliError(`WeDo Claude Motion is not running. Start it with scripts\\start.cmd (Windows) or "pnpm dev".`);
  openInBrowser(editorUrl(undefined, { lead: true }));
  console.log(`Opened ${BASE} in your browser.`);
}

const COMMANDS = {
  start: (_positional, flags) => cmdStart(flags),
  open: (_positional, flags) => cmdOpen(flags),
  status: () => cmdStatus(),
  contract: () => cmdContract(),
  project: () => cmdProject(),
  wait: (_positional, flags) => cmdWait(flags),
  respond: cmdRespond,
  fail: (positional) => cmdFail(positional),
  new: cmdNew,
  edit: cmdEdit,
  "board-styles": cmdBoardStyles,
  "board-storyboard": (positional) => cmdBoardStoryboard(positional),
  board: (positional) => cmdBoard(positional),
  "board-choose": decisionCommand("choose"),
  "board-restyle": decisionCommand("restyle"),
  "board-revise": decisionCommand("revise"),
  "board-approve": decisionCommand("approve"),
  styles: () => cmdStyles(),
  qa: (_positional, flags) => cmdQa(flags),
  reference: (positional) => cmdReference(positional),
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

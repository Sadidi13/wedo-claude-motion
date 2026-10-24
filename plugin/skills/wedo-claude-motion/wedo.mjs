#!/usr/bin/env node
/**
 * wedo.mjs — runs WeDo Claude Motion's bridge CLI from any folder, for the
 * wedo-claude-motion skill (Claude Code plugin / `npx skills add`).
 *
 *   node wedo.mjs where            print the app's folder (or how to install it)
 *   node wedo.mjs <command> ...    = node <app>/scripts/motion-bridge.mjs <command> ...
 *
 * The app is found at, in order: $WEDO_CLAUDE_MOTION_DIR, the folder recorded
 * in ~/.wedo-claude-motion/location (the installer and `motion-bridge start`
 * write it), ~/wedo-claude-motion, or a parent of the current folder that is a
 * checkout of the app. No dependencies.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const INSTALL_HELP =
  'WeDo Claude Motion is not installed on this computer. Install it by following "Steps for Claude" in ' +
  "https://github.com/Sadidi13/wedo-claude-motion/blob/main/INSTALL.md (ask the user first), then run this again.";

function isApp(dir) {
  if (!dir || !existsSync(path.join(dir, "scripts", "motion-bridge.mjs"))) return false;
  try {
    return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).name === "wedo-claude-motion";
  } catch {
    return false;
  }
}

function recorded() {
  try {
    return readFileSync(path.join(os.homedir(), ".wedo-claude-motion", "location"), "utf8").trim();
  } catch {
    return null;
  }
}

function fromCwd() {
  let dir = process.cwd();
  for (;;) {
    if (isApp(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function findApp() {
  const candidates = [process.env.WEDO_CLAUDE_MOTION_DIR, recorded(), path.join(os.homedir(), "wedo-claude-motion")];
  for (const dir of candidates) if (dir && isApp(path.resolve(dir))) return path.resolve(dir);
  return fromCwd();
}

const [command, ...rest] = process.argv.slice(2);
const app = findApp();
if (!app) {
  console.error(INSTALL_HELP);
  process.exit(3);
}
if (!command || command === "where") {
  console.log(app);
  process.exit(0);
}
if (!existsSync(path.join(app, "node_modules"))) {
  console.error(`WeDo Claude Motion at ${app} has no packages yet: run "pnpm install" in that folder (ask the user first).`);
  process.exit(3);
}
// From the app's folder, so the paths the briefs give (.motion-bridge/…) resolve there.
const child = spawn(process.execPath, [path.join(app, "scripts", "motion-bridge.mjs"), command, ...rest], { stdio: "inherit", cwd: app });
child.on("close", (code) => process.exit(code ?? 1));

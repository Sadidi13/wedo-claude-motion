/**
 * The autopilot as a background process the editor starts and stops (docs/CLAUDE-DESKTOP.md).
 *
 * The server spawns `node scripts/motion-autopilot.mjs` detached and without a window, logging to
 * `<bridge>/autopilot.log`. The script reports what it is doing in `<bridge>/autopilot.json`
 * (`AutopilotStateFile`): starting, waiting for the server, listening, working on a request (with a
 * heartbeat), signed out, stopped. The editor reads it through /api/bridge/status and
 * /api/bridge/autopilot; `launch` and the desktop shortcut start it through the same route.
 *
 * Stopping kills the whole process tree, so a Claude Code run in progress ends with it, and declines
 * what the autopilot had claimed so the editor does not wait for it. The script keeps one autopilot
 * at a time itself (`<bridge>/autopilot.lock`).
 */

import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AutopilotInfo, AutopilotState } from "@/lib/types";
import { readJsonFile, writeJsonFile } from "../jsonFile";
import { releaseClaims } from "./operations";
import { bridgeRoot, bridgeStatus } from "./store";

/** What the autopilot script writes about itself (scripts/motion-autopilot.mjs `report`). */
export interface AutopilotStateFile {
  pid: number | null;
  state: AutopilotState;
  message?: string | null;
  model?: string | null;
  effort?: AutopilotInfo["effort"];
  startedAt?: string | null;
  /** epoch ms of the last write; a "working" state older than WORKING_TTL_MS is stale */
  updatedAt: number;
}

/** The script refreshes a "working" state every few seconds while Claude runs. */
export const WORKING_TTL_MS = 20_000;

export const autopilotFiles = {
  state: () => path.join(bridgeRoot(), "autopilot.json"),
  log: () => path.join(bridgeRoot(), "autopilot.log"),
  lock: () => path.join(bridgeRoot(), "autopilot.lock"),
};

/** What the editor shows for a request the autopilot was working on when it was stopped. */
export const STOPPED_REASON = "The autopilot was stopped before it finished. Start it again and send this again.";

/** The autopilot script of this checkout (`next dev` runs with the repository as the working directory). */
export function autopilotScript(cwd = process.cwd()): string {
  return path.join(cwd, "scripts", "motion-autopilot.mjs");
}

export function isProcessAlive(pid: number | null | undefined): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Pure: the editor's view of the state file (`alive` = whether its pid still runs). */
export function describeAutopilot(file: AutopilotStateFile | null, alive: boolean, now = Date.now()): AutopilotInfo {
  if (!file) return { running: false, state: "stopped", message: null, model: null, effort: null, startedAt: null };
  const model = file.model ?? null;
  const effort = file.effort ?? null;
  const ended = file.state === "stopped" || file.state === "signed-out" || file.state === "needs-update" || file.state === "error";
  if (!alive || ended) {
    // A process that died without saying so (killed, crashed) counts as stopped.
    const state: AutopilotState = ended ? file.state : "stopped";
    return { running: false, state, message: ended ? (file.message ?? null) : null, model, effort, startedAt: null };
  }
  const state: AutopilotState = file.state === "working" && now - file.updatedAt > WORKING_TTL_MS ? "listening" : file.state;
  return { running: true, state, message: file.message ?? null, model, effort, startedAt: file.startedAt ?? null };
}

export async function readAutopilotState(): Promise<AutopilotStateFile | null> {
  return readJsonFile<AutopilotStateFile>(autopilotFiles.state()).catch(() => null);
}

export async function autopilotInfo(now = Date.now()): Promise<AutopilotInfo> {
  const file = await readAutopilotState();
  return describeAutopilot(file, isProcessAlive(file?.pid), now);
}

/**
 * The server's environment for the autopilot, minus what belongs to Next.js itself (NODE_OPTIONS
 * can carry --inspect, which would make the child fight the server for the debugger port).
 */
export function autopilotEnv(env: Record<string, string | undefined> = process.env, bridgeDir = bridgeRoot()): Record<string, string | undefined> {
  const clean: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key === "NODE_OPTIONS" || key.startsWith("__NEXT") || key.startsWith("NEXT_PRIVATE")) continue;
    clean[key] = value;
  }
  return { ...clean, MOTION_STUDIO_BRIDGE_DIR: bridgeDir, MOTION_STUDIO_AUTOPILOT_MANAGED: "1" };
}

// One start at a time: two quick clicks must not spawn two autopilots.
let starting: Promise<AutopilotInfo> | null = null;

/** Start the autopilot unless it already runs. Resolves with its state right after the start. */
export function startAutopilot(): Promise<AutopilotInfo> {
  starting ??= spawnAutopilot().finally(() => {
    starting = null;
  });
  return starting;
}

async function spawnAutopilot(): Promise<AutopilotInfo> {
  const current = await autopilotInfo();
  if (current.running) return current;
  const status = await bridgeStatus();
  if (status.listener === "listening" && status.listenerClient !== "headless") {
    // One listener at a time: a Claude chat that waits for requests answers them already.
    return { ...current, message: "A Claude chat is listening to the editor right now and answers your requests. Stop it there to use the autopilot." };
  }
  const script = autopilotScript();
  if (!existsSync(script)) throw new Error(`The autopilot script is missing: ${script}`);
  mkdirSync(bridgeRoot(), { recursive: true });
  const log = openSync(autopilotFiles.log(), "a");
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(process.execPath, [script], {
      cwd: path.dirname(path.dirname(script)),
      detached: true,
      windowsHide: true,
      stdio: ["ignore", log, log],
      env: autopilotEnv() as NodeJS.ProcessEnv,
    });
  } finally {
    closeSync(log); // the child has its own handle
  }
  child.on("error", () => undefined); // a failed start leaves no pid: the editor then shows "stopped"
  child.unref();
  const startedAt = new Date().toISOString();
  await writeJsonFile(autopilotFiles.state(), { pid: child.pid ?? null, state: "starting", startedAt, updatedAt: Date.now() } satisfies AutopilotStateFile);
  return { running: true, state: "starting", message: null, model: null, effort: null, startedAt };
}

/** Remove the lock when its holder is the stopped autopilot or no longer runs (pids get reused). */
function clearLock(stoppedPid: number | null): void {
  try {
    const holder = Number(readFileSync(autopilotFiles.lock(), "utf8").trim());
    if (holder === stoppedPid || !isProcessAlive(holder)) rmSync(autopilotFiles.lock(), { force: true });
  } catch {
    // no lock
  }
}

/** Stop the autopilot and any Claude Code run it started; what it had claimed is declined. */
export async function stopAutopilot(): Promise<AutopilotInfo> {
  const file = await readAutopilotState();
  const pid = file?.pid ?? null;
  if (pid && isProcessAlive(pid)) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
    } else {
      try {
        process.kill(-pid, "SIGTERM"); // the detached child leads its own process group
      } catch {
        process.kill(pid, "SIGTERM");
      }
    }
  }
  clearLock(pid);
  const model = file?.model ?? null;
  const effort = file?.effort ?? null;
  await writeJsonFile(autopilotFiles.state(), { pid: null, state: "stopped", model, effort, updatedAt: Date.now() } satisfies AutopilotStateFile);
  await releaseClaims("headless", STOPPED_REASON);
  return { running: false, state: "stopped", message: null, model, effort, startedAt: null };
}

/** The last `lines` lines of the autopilot's log (what a console window would show). */
export async function autopilotLogTail(lines = 40): Promise<string[]> {
  const TAIL_BYTES = 24 * 1024;
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(autopilotFiles.log(), "r");
  } catch {
    return [];
  }
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.toString("utf8").split(/\r?\n/);
    if (start > 0) text.shift(); // a partial first line
    return text.filter((line) => line.trim()).slice(-lines);
  } finally {
    await handle.close();
  }
}

/** The Claude Code executable, found the way the autopilot finds it. */
export function claudeCommand(): string {
  if (process.env.MOTION_STUDIO_CLAUDE_BIN) return process.env.MOTION_STUDIO_CLAUDE_BIN;
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["claude"], { encoding: "utf8", windowsHide: true });
  const onPath = probe.status === 0 ? probe.stdout.split(/\r?\n/).find((line) => line.trim()) : undefined;
  if (onPath) return onPath.trim();
  const native = path.join(os.homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
  return existsSync(native) ? native : "claude";
}

/**
 * Update Claude Code (`claude update`), for when the autopilot's model needs a newer version. Runs
 * without a window; resolves with what it printed (the last lines). Start the autopilot again after.
 */
export function updateClaudeCode(): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const child = spawn(claudeCommand(), ["update"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-4_000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => child.kill(), 10 * 60_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, message: `Could not run Claude Code: ${error.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const lines = output.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" ");
      resolve({ ok: code === 0, message: lines || (code === 0 ? "Claude Code is up to date." : `claude update exited with code ${code}`) });
    });
  });
}

/**
 * Open a terminal window that signs Claude Code in with the Claude account (`claude auth login
 * --claudeai`); the user finishes in the browser, then starts the autopilot again. Windows only:
 * elsewhere the returned message says what to run.
 */
export function openSignIn(): { opened: boolean; message: string } {
  const command = `"${claudeCommand()}" auth login --claudeai`;
  if (process.platform !== "win32") return { opened: false, message: `Run this in a terminal, then start the autopilot again: ${command}` };
  spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `start "Claude sign-in" cmd /k ${command}`], {
    detached: true,
    stdio: "ignore",
    windowsVerbatimArguments: true,
  }).unref();
  return { opened: true, message: "Sign in with your Claude account in the window that opened, then start the autopilot again." };
}

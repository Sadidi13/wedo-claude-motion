/**
 * Where this server listens, recorded for the Claude tools (CLI, MCP connector, autopilot,
 * Windows helpers) so they follow the real port instead of assuming 3000 (`next dev` moves to
 * 3001, 3002, … when 3000 is taken, and users can pass `--port`).
 *
 *   <bridge state>/server.json   { port, pid, instance, recordedAt }
 *
 * `instance` identifies this checkout's bridge folder. The tools only accept a server that reports
 * the same id, so they never talk to (or send their token to) another app, or another copy of
 * this project, that happens to answer on a nearby port.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { bridgeRoot } from "./store";

export interface ServerInfo {
  port: number;
  pid: number;
  instance: string;
  recordedAt: string;
}

/** Stable id of a bridge state folder; the tools compute the same value from their own path. */
export function instanceIdFor(folder: string): string {
  const resolved = path.resolve(folder);
  const normalised = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  return createHash("sha256").update(normalised).digest("hex").slice(0, 16);
}

export function bridgeInstanceId(): string {
  return instanceIdFor(bridgeRoot());
}

const serverInfoFile = () => path.join(bridgeRoot(), "server.json");

let lastRecorded = "";

/** Write server.json when the port or process changed (cheap to call on every status request). */
export async function recordServerPort(port: number, now = new Date()): Promise<void> {
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return;
  const key = `${port}:${process.pid}`;
  if (key === lastRecorded) return;
  try {
    const current = JSON.parse(await readFile(serverInfoFile(), "utf8")) as Partial<ServerInfo>;
    if (current.port === port && current.pid === process.pid) {
      lastRecorded = key;
      return;
    }
  } catch {
    // missing or unreadable: write a fresh one
  }
  const info: ServerInfo = { port, pid: process.pid, instance: bridgeInstanceId(), recordedAt: now.toISOString() };
  await mkdir(bridgeRoot(), { recursive: true, mode: 0o700 });
  await writeFile(serverInfoFile(), JSON.stringify(info), "utf8");
  lastRecorded = key;
}

/** The port Next.js actually bound (it sets PORT once listening, also after moving off a busy port). */
export function listeningPort(env: Record<string, string | undefined> = process.env): number | null {
  const port = Number(env.PORT);
  return Number.isInteger(port) && port > 0 ? port : null;
}

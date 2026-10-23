/**
 * Server discovery: the server records its real port (server.json) and an instance id; the Claude
 * tools (scripts/lib/bridge-client.mjs) follow that port and only accept a server whose instance id
 * matches their own bridge folder.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bridgeInstanceId, instanceIdFor, listeningPort, recordServerPort } from "../server-info";

const CLIENT = path.resolve(import.meta.dirname, "../../../../../scripts/lib/bridge-client.mjs");

let root: string;
const servers: http.Server[] = [];

/** A stand-in for /api/bridge/status that reports `instance`. */
async function fakeServer(instance: string): Promise<number> {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/api/bridge/status")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ listener: "offline", editorOpen: false, pending: 0, project: null, instance }));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "motion-studio-discovery-test-"));
  process.env.MOTION_STUDIO_BRIDGE_DIR = root;
  delete process.env.MOTION_STUDIO_URL;
  vi.resetModules();
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

afterAll(async () => {
  delete process.env.MOTION_STUDIO_BRIDGE_DIR;
  await rm(root, { recursive: true, force: true });
});

describe("server side", () => {
  it("reads the port Next.js bound", () => {
    expect(listeningPort({ PORT: "3001" })).toBe(3001);
    expect(listeningPort({})).toBeNull();
    expect(listeningPort({ PORT: "abc" })).toBeNull();
  });

  it("records port, pid and instance in server.json", async () => {
    await recordServerPort(3004);
    const info = JSON.parse(await readFile(path.join(root, "server.json"), "utf8"));
    expect(info).toMatchObject({ port: 3004, pid: process.pid, instance: bridgeInstanceId() });
  });

  it("derives the same id from equivalent paths", () => {
    expect(instanceIdFor(root)).toBe(instanceIdFor(`${root}${path.sep}`));
    expect(instanceIdFor(root)).not.toBe(instanceIdFor(path.join(root, "other")));
  });
});

describe("tools", () => {
  it("follow the port in server.json to a server of their own checkout", async () => {
    const port = await fakeServer(instanceIdFor(root));
    await writeFile(path.join(root, "server.json"), JSON.stringify({ port, pid: 1, instance: instanceIdFor(root) }));
    const client = await import(CLIENT);
    expect(client.INSTANCE_ID).toBe(instanceIdFor(root));
    expect(await client.resolveBase()).toBe(`http://localhost:${port}`);
    expect(client.BASE).toBe(`http://localhost:${port}`);
    expect(client.editorUrl()).toBe(`http://localhost:${port}/`);
  });

  it("refuse a server of another checkout or app on that port", async () => {
    const port = await fakeServer("someone-else");
    await writeFile(path.join(root, "server.json"), JSON.stringify({ port, pid: 1, instance: "x" }));
    const client = await import(CLIENT);
    expect(await client.resolveBase()).toBeNull();
    await expect(client.getStatus()).rejects.toThrow(/not running/);
  });

  it("use MOTION_STUDIO_URL as given", async () => {
    process.env.MOTION_STUDIO_URL = "http://localhost:4321/";
    const client = await import(CLIENT);
    expect(await client.resolveBase()).toBe("http://localhost:4321");
    delete process.env.MOTION_STUDIO_URL;
  });
});

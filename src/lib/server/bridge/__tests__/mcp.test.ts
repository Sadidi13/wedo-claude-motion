/**
 * Protocol tests for scripts/motion-studio-mcp.mjs: JSON-RPC handshake, tool
 * and prompt listings, and tool errors when Motion Studio is not running
 * (MOTION_STUDIO_URL points at a closed port). The happy paths against a real
 * server are covered by the bridge store / operations tests.
 */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(import.meta.dirname, "../../../../../scripts/motion-studio-mcp.mjs");

interface RpcResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

let child: ChildProcessWithoutNullStreams;
let nextId = 1;
const waiting = new Map<number, (response: RpcResponse) => void>();

function rpc(method: string, params?: unknown): Promise<RpcResponse> {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve) => waiting.set(id, resolve));
}

beforeAll(() => {
  child = spawn(process.execPath, [SCRIPT], {
    env: { ...process.env, MOTION_STUDIO_URL: "http://127.0.0.1:9" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const message = JSON.parse(line) as RpcResponse;
      waiting.get(message.id)?.(message);
      waiting.delete(message.id);
    }
  });
});

afterAll(() => {
  child.stdin.end();
  child.kill();
});

describe("motion-studio MCP connector", () => {
  it("negotiates the protocol and describes itself", async () => {
    const response = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(response.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: {}, prompts: {} },
      serverInfo: { name: "motion-studio" },
    });
    expect(String(response.result?.instructions)).toContain("wait_for_request");
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  });

  it("falls back to its newest protocol for an unknown version", async () => {
    const response = await rpc("initialize", { protocolVersion: "1999-01-01", capabilities: {} });
    expect(response.result?.protocolVersion).toBe("2025-11-25");
  });

  it("lists every tool with an object input schema", async () => {
    const response = await rpc("tools/list");
    const tools = response.result?.tools as { name: string; inputSchema: { type: string } }[];
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "answer_request",
        "check_quality",
        "create_scene",
        "decline_request",
        "edit_scene",
        "get_authoring_guide",
        "get_open_project",
        "get_board",
        "get_board_references",
        "get_status",
        "get_style_library",
        "propose_storyboard",
        "propose_styles",
        "record_decision",
        "start_motion_studio",
        "wait_for_request",
      ].sort(),
    );
    for (const tool of tools) expect(tool.inputSchema.type).toBe("object");
  });

  it("offers the listen and check prompts", async () => {
    const list = await rpc("prompts/list");
    expect((list.result?.prompts as { name: string }[]).map((p) => p.name)).toEqual(["listen", "check"]);
    const listen = await rpc("prompts/get", { name: "listen" });
    expect(JSON.stringify(listen.result)).toContain("wait_for_request");
  });

  it("reports a stopped server as a tool error, not a protocol error", async () => {
    const response = await rpc("tools/call", { name: "get_status", arguments: {} });
    expect(response.error).toBeUndefined();
    expect(response.result?.isError).toBe(true);
    expect(JSON.stringify(response.result)).toContain("not running");
  });

  it("validates required arguments before calling the server", async () => {
    const response = await rpc("tools/call", { name: "answer_request", arguments: { request_id: "x" } });
    expect(response.result?.isError).toBe(true);
    expect(JSON.stringify(response.result)).toContain('\\"summary\\" is required');
  });

  it("rejects unknown tools and methods", async () => {
    expect((await rpc("tools/call", { name: "nope", arguments: {} })).error?.code).toBe(-32602);
    expect((await rpc("resources/list")).error?.code).toBe(-32601);
    expect((await rpc("ping")).result).toEqual({});
  });
});

/**
 * Service tests with a fake Anthropic client: request shape (cached system
 * block, user content, output_config / effort / max_tokens, parse vs stream),
 * stop-reason handling, validation retry, error-class mapping and status codes.
 */
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiEditRequest } from "@/lib/types";
import type { AiOutput } from "../schema";
import {
  type AiClient,
  type AiParseParams,
  type AiStreamParams,
  NON_STREAMING_MAX_TOKENS,
  createAiService,
  httpStatusFor,
  mapSdkError,
  resolveModel,
} from "../service";
import { GOOD_LAYER_CODE, GOOD_SCENE_CODE, SCENE_SOURCE, makeProject, makeRequest } from "./fixture";

type Call = { kind: "parse"; params: AiParseParams } | { kind: "stream"; params: AiStreamParams };

function message(text: string, overrides: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    container: null,
    diagnostics: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 20,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
      speed: null,
    },
    ...overrides,
  };
}

const json = (output: AiOutput): string => JSON.stringify(output);

/**
 * Mimics the SDK surface the service uses. `parse()` runs the zod output
 * format's `parse` on every text block (and therefore throws AnthropicError
 * on non-JSON text, exactly like the SDK); `stream().finalMessage()` returns
 * the message untouched.
 */
function fakeClient(queue: Array<Anthropic.Message | Error>) {
  const calls: Call[] = [];
  const next = (): Anthropic.Message => {
    const item = queue.shift();
    if (!item) throw new Error("fake client: no more queued responses");
    if (item instanceof Error) throw item;
    return item;
  };
  const client: AiClient = {
    messages: {
      async parse(params) {
        calls.push({ kind: "parse", params });
        const m = next();
        let first: AiOutput | null = null;
        const content = m.content.map((block) => {
          if (block.type !== "text") return block;
          const parsed = params.output_config.format.parse(block.text);
          first ??= parsed;
          return { ...block, parsed_output: parsed };
        });
        return { ...m, content, parsed_output: first };
      },
      stream(params) {
        calls.push({ kind: "stream", params });
        return { finalMessage: async () => next() };
      },
    },
  };
  return { client, calls };
}

function lastUserText(params: AiParseParams | AiStreamParams): string {
  const last = params.messages[params.messages.length - 1];
  if (typeof last.content === "string") return last.content;
  return last.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createAiService — request shape", () => {
  it("a real Anthropic client satisfies the AiClient interface", () => {
    const real: AiClient = new Anthropic({ apiKey: "test-key-not-used" });
    expect(typeof real.messages.parse).toBe("function");
    expect(typeof real.messages.stream).toBe("function");
  });

  it("layer scope: messages.parse with zodOutputFormat, medium effort, 16k tokens, cached system block", async () => {
    const { client, calls } = fakeClient([message(json({ summary: "عنوان حالا نرم‌تر وارد می‌شود.", code: GOOD_LAYER_CODE }))]);
    const service = createAiService({ client, model: "claude-opus-5-5" });
    const result = await service.edit(makeRequest({ prompt: "عنوان را نرم‌تر وارد کن" }));

    expect(result).toMatchObject({ ok: true, scope: "layer", summary: "عنوان حالا نرم‌تر وارد می‌شود." });
    if (!result.ok) return;
    expect(result.layerCode).toContain('data-layer-id="title"');
    expect(result.layerCode).toContain("translateY");
    expect(result.sceneCode).toBeUndefined();
    expect(result.usage).toEqual({ inputTokens: 130, outputTokens: 50, model: "claude-opus-5-5" });

    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe("parse");
    const params = calls[0].params;
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.max_tokens).toBe(16_000);
    expect(params.max_tokens).toBeLessThanOrEqual(NON_STREAMING_MAX_TOKENS);
    expect(params.output_config.effort).toBe("medium");
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.output_config.format.schema).toMatchObject({ type: "object", required: ["summary", "code"] });
    expect("parse" in params.output_config.format).toBe(true);
    expect(params.system).toEqual([expect.objectContaining({ type: "text", cache_control: { type: "ephemeral" } })]);
    for (const forbidden of ["thinking", "temperature", "top_p", "top_k", "tool_choice", "tools", "stream"]) {
      expect(forbidden in params).toBe(false);
    }
    expect(params.messages).toHaveLength(1);
    const text = lastUserText(params);
    expect(text).toMatch(/^\s*1 \| import React/m);
    expect(text).toContain("# Selected layer");
    expect(text).toContain("عنوان را نرم‌تر وارد کن");
  });

  it("scene scope: messages.stream + finalMessage, high effort, 32k tokens, plain json_schema format", async () => {
    const { client, calls } = fakeClient([message(json({ summary: "Rebuilt the scene.", code: GOOD_SCENE_CODE }))]);
    const service = createAiService({ client, model: "claude-opus-5-5" });
    const result = await service.edit(makeRequest({ scope: "scene", layerId: undefined }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scope).toBe("scene");
    expect(result.layerCode).toBeUndefined();
    expect(result.sceneCode).toContain("<Stage");
    expect(result.sceneCode).toMatch(/data-layer-id="sprite-[a-z0-9]{6}"/);

    expect(calls[0].kind).toBe("stream");
    const params = calls[0].params;
    expect(params.max_tokens).toBe(32_000);
    expect(params.max_tokens).toBeGreaterThan(NON_STREAMING_MAX_TOKENS);
    expect(params.output_config.effort).toBe("high");
    expect(params.output_config.format).toEqual({ type: "json_schema", schema: expect.objectContaining({ type: "object" }) });
    expect("parse" in params.output_config.format).toBe(false);
    expect(lastUserText(params)).not.toContain("# Selected layer");
  });

  it("new scope works on a project without an entry file and forwards helper files", async () => {
    const files = [{ path: "styles.css", content: "h1 { color: white }" }];
    const { client, calls } = fakeClient([message(json({ summary: "Created.", code: GOOD_SCENE_CODE, files }))]);
    const service = createAiService({ client, model: "m" });
    const result = await service.edit(makeRequest({ scope: "new", layerId: undefined, project: makeProject(null) }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files).toEqual(files);
    expect(calls[0].kind).toBe("stream");
    expect(calls[0].params.output_config.effort).toBe("high");
    expect(lastUserText(calls[0].params)).toContain("(no entry file yet");
  });

  it("puts history turns before the final user turn", async () => {
    const { client, calls } = fakeClient([message(json({ summary: "ok", code: GOOD_LAYER_CODE }))]);
    const service = createAiService({ client, model: "m" });
    await service.edit(makeRequest({ history: [{ role: "user", content: "bigger" }, { role: "assistant", content: "made it bigger" }] }));
    expect(calls[0].params.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });
});

describe("createAiService — stop reasons and validation retry", () => {
  it("maps a refusal", async () => {
    const refused = message("", {
      content: [],
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "cyber", explanation: "not this" },
    });
    const { client } = fakeClient([refused]);
    const result = await createAiService({ client, model: "m" }).edit(makeRequest());
    expect(result).toEqual({ ok: false, code: "refusal", error: "Claude declined this request: not this" });
    expect(httpStatusFor(result)).toBe(422);
  });

  it("maps a max_tokens stop to truncated (stream path, no parse throw)", async () => {
    const cut = message('{"summary":"half', { stop_reason: "max_tokens" });
    const { client } = fakeClient([cut]);
    const result = await createAiService({ client, model: "m" }).edit(makeRequest({ scope: "scene", layerId: undefined }));
    expect(result).toMatchObject({ ok: false, code: "truncated" });
    expect(httpStatusFor(result)).toBe(422);
  });

  it("retries once with the validation error, then gives up with invalid_output", async () => {
    const bad = json({ summary: "two", code: "<><div /><div /></>" });
    const { client, calls } = fakeClient([message(bad), message(bad)]);
    const result = await createAiService({ client, model: "m" }).edit(makeRequest());

    expect(result).toMatchObject({ ok: false, code: "invalid_output" });
    if (result.ok) return;
    expect(result.error).toContain("exactly one JSX element");
    expect(httpStatusFor(result)).toBe(422);

    expect(calls).toHaveLength(2);
    const retry = calls[1].params.messages;
    expect(retry).toHaveLength(3);
    expect(retry[1]).toEqual({ role: "assistant", content: bad });
    expect(retry[2].role).toBe("user");
    expect(retry[2].content).toMatch(
      /^Your output failed validation: [\s\S]*exactly one JSX element[\s\S]*Fix it and return the corrected output\.$/,
    );
    // the original turn is sent again unchanged (prefix stays cache-friendly)
    expect(retry[0]).toBe(calls[0].params.messages[0]);
  });

  it("succeeds on the retry and sums usage over both calls", async () => {
    const { client, calls } = fakeClient([
      message(json({ summary: "two", code: "<><div /><div /></>" })),
      message(json({ summary: "fixed", code: GOOD_LAYER_CODE })),
    ]);
    const result = await createAiService({ client, model: "m" }).edit(makeRequest());
    expect(result).toMatchObject({ ok: true, summary: "fixed", usage: { inputTokens: 260, outputTokens: 100 } });
    expect(calls).toHaveLength(2);
  });

  it("treats non-JSON text on the stream path as a validation failure (retry, then invalid_output)", async () => {
    const { client, calls } = fakeClient([message("Sure! Here is the scene: <Stage />"), message("still not json")]);
    const result = await createAiService({ client, model: "m" }).edit(makeRequest({ scope: "scene", layerId: undefined }));
    expect(result).toMatchObject({ ok: false, code: "invalid_output" });
    if (result.ok) return;
    expect(result.error).toContain("not valid JSON");
    expect(calls).toHaveLength(2);
  });

  it("rejects schema-valid JSON whose code fails the forbidden-API rule, with the rule in the error", async () => {
    const bad = json({ summary: "x", code: '<div data-layer-id="title" style={{ left: Date.now() }} />' });
    const { client } = fakeClient([message(bad), message(bad)]);
    const result = await createAiService({ client, model: "m" }).edit(makeRequest());
    expect(result).toMatchObject({ ok: false, code: "invalid_output" });
    if (!result.ok) expect(result.error).toContain("Date.now");
  });
});

describe("createAiService — errors and preconditions", () => {
  it("maps SDK error classes, most specific first", async () => {
    const cases: Array<[Error, string, number]> = [
      [new Anthropic.AuthenticationError(401, { type: "authentication_error" }, "invalid x-api-key", new Headers()), "auth", 502],
      [new Anthropic.RateLimitError(429, { type: "rate_limit_error" }, "slow down", new Headers()), "rate_limit", 502],
      [new Anthropic.APIConnectionError({ message: "ECONNRESET" }), "network", 502],
      [new Anthropic.APIError(500, { type: "api_error" }, "overloaded", new Headers()), "api_error", 502],
      [new Anthropic.AnthropicError("Failed to parse structured output"), "invalid_output", 422],
      [new TypeError("boom"), "internal", 500],
    ];
    for (const [err, code, status] of cases) {
      const { client } = fakeClient([err]);
      const result = await createAiService({ client, model: "m" }).edit(makeRequest());
      expect(result).toMatchObject({ ok: false, code });
      expect(httpStatusFor(result)).toBe(status);
    }
    expect(mapSdkError("string error")).toEqual({ ok: false, code: "internal", error: "string error" });
  });

  it("maps non-JSON text on the parse path (SDK parser throw) to invalid_output", async () => {
    const { client } = fakeClient([message("not json at all")]);
    const result = await createAiService({ client, model: "m" }).edit(makeRequest());
    expect(result).toMatchObject({ ok: false, code: "invalid_output" });
    if (!result.ok) expect(result.error).toContain("structured output");
  });

  it("returns missing_api_key (503) when no client and no key are available", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const result = await createAiService().edit(makeRequest());
    expect(result).toEqual({ ok: false, code: "missing_api_key", error: "Set ANTHROPIC_API_KEY in .env.local" });
    expect(httpStatusFor(result)).toBe(503);
  });

  it("reads the model from MOTION_STUDIO_MODEL with a default", () => {
    vi.stubEnv("MOTION_STUDIO_MODEL", "");
    expect(resolveModel()).toBe("claude-opus-5-5");
    expect(createAiService({ client: fakeClient([]).client }).model).toBe("claude-opus-5-5");
    vi.stubEnv("MOTION_STUDIO_MODEL", "claude-sonnet-5-5");
    expect(createAiService({ client: fakeClient([]).client }).model).toBe("claude-sonnet-5-5");
  });

  it("rejects malformed requests before calling the model (bad_request, 400)", async () => {
    const { client, calls } = fakeClient([]);
    const service = createAiService({ client, model: "m" });
    const cases: Array<[AiEditRequest, string]> = [
      [makeRequest({ layerId: undefined }), "layerId is required"],
      [makeRequest({ layerId: "ghost" }), 'Layer "ghost" does not exist'],
      [makeRequest({ project: makeProject(null) }), "is missing from the project"],
      [makeRequest({ scope: "scene", project: makeProject("export default 1 +") }), "does not parse"],
      [makeRequest({ project: makeProject(SCENE_SOURCE.replace("<Stage", "<Stagex")) }), "does not parse"],
    ];
    for (const [request, needle] of cases) {
      const result = await service.edit(request);
      expect(result).toMatchObject({ ok: false, code: "bad_request" });
      if (!result.ok) expect(result.error).toContain(needle);
      expect(httpStatusFor(result)).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("httpStatusFor covers every code", () => {
    expect(httpStatusFor({ ok: true, scope: "layer", summary: "" })).toBe(200);
    expect(httpStatusFor({ ok: false, code: "something_else", error: "" })).toBe(500);
  });
});

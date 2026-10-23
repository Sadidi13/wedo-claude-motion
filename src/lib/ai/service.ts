/**
 * The AI edit service (CONTRACTS §5): one `edit(request)` call that builds the
 * prompt, talks to Claude with structured outputs, validates the answer,
 * retries once with the validation error, and maps every failure to an
 * `AiErrorResponse` code.
 *
 * SDK usage (verified against @anthropic-ai/sdk 1.1.0):
 * - model `MOTION_STUDIO_MODEL` || "claude-opus-5-5"; no `thinking` parameter
 *   (Opus 5.5 is adaptive-only and rejects disabled/budget), no sampling
 *   params, no tool_choice; depth is controlled with `output_config.effort`.
 * - scope "layer" (16k max_tokens): `client.messages.parse` + `zodOutputFormat`.
 * - scope "scene" | "new" (32k max_tokens): the SDK refuses a non-streaming
 *   request whose `max_tokens` implies more than 10 minutes at its reference
 *   rate (max_tokens > 21 333), so these go through `client.messages.stream()`
 *   + `finalMessage()`. The stream is given the JSON schema WITHOUT the SDK's
 *   `parse` hook: the SDK's auto-parser throws on any text block that is not
 *   schema-valid JSON, which would hide a `max_tokens` / `refusal` stop reason.
 *   We inspect `stop_reason` first and parse the text with the same zod schema.
 * - server-side refusal fallback (`fallbacks: "default"`) exists only on the
 *   beta namespace in this SDK version and is deliberately not used (see
 *   integration notes).
 *
 * `createAiService({ client })` lets tests inject a fake client with the same
 * `messages.parse` / `messages.stream` shape.
 */
import Anthropic, { type AutoParseableOutputFormat, type ParsedMessage } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { parseScene } from "@/lib/parser";
import type { AiEditRequest, AiEditResponse, AiErrorResponse, AiScope, ParsedScene } from "@/lib/types";
import { buildMessages, buildSystem } from "./prompts";
import { type AiOutput, AiOutputSchema } from "./schema";
import { validateAiOutput } from "./validate";

export const DEFAULT_MODEL = "claude-opus-5-5";

/** Model id from the environment, falling back to the default (read at call time so tests can stub env). */
export function resolveModel(): string {
  return process.env.MOTION_STUDIO_MODEL || DEFAULT_MODEL;
}

export const MISSING_API_KEY_MESSAGE = "Set ANTHROPIC_API_KEY in .env.local";

/**
 * Largest `max_tokens` the SDK accepts on a non-streaming call: it throws when
 * `max_tokens * 60min / 128000 > 10min`, i.e. above 21 333 tokens.
 */
export const NON_STREAMING_MAX_TOKENS = Math.floor((128_000 * 10) / 60);

type Effort = NonNullable<NonNullable<Anthropic.MessageCreateParams["output_config"]>["effort"]>;

/** Per-scope generation budget: a single element is cheap, a whole scene is not. */
export const SCOPE_LIMITS: Record<AiScope, { maxTokens: number; effort: Effort }> = {
  layer: { maxTokens: 16_000, effort: "medium" },
  scene: { maxTokens: 32_000, effort: "high" },
  new: { maxTokens: 32_000, effort: "high" },
};

const OUTPUT_FORMAT = zodOutputFormat(AiOutputSchema);
/** Same schema, without the SDK `parse` hook (see header comment). */
const PLAIN_OUTPUT_FORMAT: Anthropic.JSONOutputFormat = { type: "json_schema", schema: OUTPUT_FORMAT.schema };

type BaseParams = Omit<Anthropic.MessageCreateParamsNonStreaming, "output_config">;
export type AiParseParams = BaseParams & {
  output_config: { effort: Effort; format: AutoParseableOutputFormat<AiOutput> };
};
export type AiStreamParams = BaseParams & {
  output_config: { effort: Effort; format: Anthropic.JSONOutputFormat };
};

/** The subset of the Anthropic client the service uses; a real `Anthropic` instance satisfies it. */
export interface AiClient {
  messages: {
    parse(params: AiParseParams): Promise<ParsedMessage<AiOutput>>;
    stream(params: AiStreamParams): { finalMessage(): Promise<Anthropic.Message> };
  };
}

export interface AiServiceOptions {
  /** injected client (tests); when omitted a real client is created from `apiKey` / ANTHROPIC_API_KEY */
  client?: AiClient;
  model?: string;
  apiKey?: string;
}

export interface AiService {
  readonly model: string;
  edit(request: AiEditRequest): Promise<AiEditResponse | AiErrorResponse>;
}

/** HTTP status for an edit result (400 bad request, 503 no key, 502 upstream, 422 unusable output). */
export function httpStatusFor(result: AiEditResponse | AiErrorResponse): number {
  if (result.ok) return 200;
  switch (result.code) {
    case "bad_request":
      return 400;
    case "missing_api_key":
      return 503;
    case "invalid_output":
    case "refusal":
    case "truncated":
      return 422;
    case "auth":
    case "rate_limit":
    case "network":
    case "api_error":
      return 502;
    default:
      return 500;
  }
}

function fail(code: string, error: string): AiErrorResponse {
  return { ok: false, code, error };
}

/** Map SDK exceptions to error codes, most specific class first. */
export function mapSdkError(err: unknown): AiErrorResponse {
  if (err instanceof Anthropic.AuthenticationError) {
    return fail("auth", `Anthropic rejected the API key: ${err.message}`);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return fail("rate_limit", `Anthropic rate limit reached: ${err.message}`);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return fail("network", `Could not reach the Anthropic API: ${err.message}`);
  }
  if (err instanceof Anthropic.APIError) {
    const status = err.status !== undefined ? ` (${err.status})` : "";
    return fail("api_error", `Anthropic API error${status}: ${err.message}`);
  }
  if (err instanceof Anthropic.AnthropicError) {
    // Thrown by the SDK's structured-output parser (messages.parse) when the
    // text is not schema-valid JSON — in practice a reply cut off by max_tokens.
    return fail("invalid_output", `The model's structured output could not be parsed: ${err.message}`);
  }
  return fail("internal", err instanceof Error ? err.message : String(err));
}

type Prepared = { ok: true; entrySource?: string; scene: ParsedScene | null } | { ok: false; response: AiErrorResponse };

/** Read + parse the entry file and check the request makes sense for its scope. */
function prepare(request: AiEditRequest): Prepared {
  const entry = request.project.files[request.project.entry];
  const needsEntry = request.scope !== "new";
  if (!entry) {
    return needsEntry
      ? { ok: false, response: fail("bad_request", `Entry file "${request.project.entry}" is missing from the project`) }
      : { ok: true, scene: null };
  }
  let scene: ParsedScene | null = null;
  try {
    scene = parseScene(entry.content);
  } catch (err) {
    if (needsEntry) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, response: fail("bad_request", `Entry file does not parse: ${message}`) };
    }
  }
  if (request.scope === "layer") {
    if (!request.layerId) return { ok: false, response: fail("bad_request", 'layerId is required for scope "layer"') };
    if (!scene?.byId[request.layerId]) {
      return { ok: false, response: fail("bad_request", `Layer "${request.layerId}" does not exist in the scene`) };
    }
  }
  return { ok: true, entrySource: entry.content, scene };
}

/** Successful edit response from validated output (shared by the API path and the Claude Desktop bridge). */
function successResponse(
  scope: AiScope,
  summary: string,
  validation: { layerCode?: string; sceneCode?: string; files?: { path: string; content: string }[] },
  usage?: Usage,
): AiEditResponse {
  return {
    ok: true,
    scope,
    summary: summary.trim(),
    ...(validation.layerCode !== undefined ? { layerCode: validation.layerCode } : {}),
    ...(validation.sceneCode !== undefined ? { sceneCode: validation.sceneCode } : {}),
    ...(validation.files ? { files: validation.files } : {}),
    ...(usage ? { usage } : {}),
  };
}

/**
 * Turn output written somewhere other than the API call (the Claude Desktop
 * bridge) into the same `AiEditResponse` the API path produces: the request is
 * checked like `edit` does, then the output goes through `validateAiOutput`.
 * Validation failures come back as `invalid_output` with the plain-English error.
 */
export function finalizeOutput(request: AiEditRequest, output: AiOutput): AiEditResponse | AiErrorResponse {
  const prepared = prepare(request);
  if (!prepared.ok) return prepared.response;
  const validation = validateAiOutput(output, {
    scope: request.scope,
    entryPath: request.project.entry,
    entrySource: prepared.entrySource,
    layerId: request.layerId,
  });
  if (!validation.ok) return fail("invalid_output", validation.error);
  return successResponse(request.scope, output.summary, validation);
}

type Extracted = { ok: true; output: AiOutput; raw: string } | { ok: false; error: string; raw: string };

/** Use the SDK-parsed output when present, otherwise parse the text blocks with the zod schema. */
function extractOutput(message: Anthropic.Message, parsed: AiOutput | null): Extracted {
  if (parsed) return { ok: true, output: parsed, raw: JSON.stringify(parsed) };
  const raw = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  if (!raw) return { ok: false, error: "The response contained no text", raw };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `The response is not valid JSON: ${err instanceof Error ? err.message : String(err)}`, raw };
  }
  const result = AiOutputSchema.safeParse(json);
  if (!result.success) {
    return { ok: false, error: `The response JSON does not match the schema: ${z.prettifyError(result.error)}`, raw };
  }
  return { ok: true, output: result.data, raw };
}

interface Usage {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

function addUsage(total: Usage, message: Anthropic.Message): void {
  const u = message.usage;
  total.inputTokens += u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  total.outputTokens += u.output_tokens;
  total.model = message.model;
}

export function createAiService(options: AiServiceOptions = {}): AiService {
  const model = options.model ?? resolveModel();
  let client: AiClient | null = options.client ?? null;

  function getClient(): AiClient | null {
    if (client) return client;
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    client = new Anthropic({ apiKey });
    return client;
  }

  async function callModel(
    api: AiClient,
    scope: AiScope,
    messages: Anthropic.MessageParam[],
  ): Promise<{ message: Anthropic.Message; parsed: AiOutput | null }> {
    const { maxTokens, effort } = SCOPE_LIMITS[scope];
    const base: BaseParams = { model, max_tokens: maxTokens, system: buildSystem(), messages };
    if (maxTokens <= NON_STREAMING_MAX_TOKENS) {
      const message = await api.messages.parse({ ...base, output_config: { effort, format: OUTPUT_FORMAT } });
      return { message, parsed: message.parsed_output };
    }
    const message = await api.messages
      .stream({ ...base, output_config: { effort, format: PLAIN_OUTPUT_FORMAT } })
      .finalMessage();
    return { message, parsed: null };
  }

  async function edit(request: AiEditRequest): Promise<AiEditResponse | AiErrorResponse> {
    const prepared = prepare(request);
    if (!prepared.ok) return prepared.response;

    const api = getClient();
    if (!api) return fail("missing_api_key", MISSING_API_KEY_MESSAGE);

    const messages = buildMessages(request, prepared.scene);
    const usage: Usage = { inputTokens: 0, outputTokens: 0, model };
    const ctx = {
      scope: request.scope,
      entryPath: request.project.entry,
      entrySource: prepared.entrySource,
      layerId: request.layerId,
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      let turn: { message: Anthropic.Message; parsed: AiOutput | null };
      try {
        turn = await callModel(api, request.scope, messages);
      } catch (err) {
        return mapSdkError(err);
      }
      addUsage(usage, turn.message);

      if (turn.message.stop_reason === "refusal") {
        const why = turn.message.stop_details?.explanation;
        return fail("refusal", why ? `Claude declined this request: ${why}` : "Claude declined this request");
      }
      if (turn.message.stop_reason === "max_tokens") {
        return fail("truncated", `The reply exceeded ${SCOPE_LIMITS[request.scope].maxTokens} output tokens and was cut off`);
      }

      const extracted = extractOutput(turn.message, turn.parsed);
      const validation = extracted.ok ? validateAiOutput(extracted.output, ctx) : extracted;
      if (validation.ok && extracted.ok) {
        return successResponse(request.scope, extracted.output.summary, validation, usage);
      }
      const error = validation.ok ? "unknown validation failure" : validation.error;
      if (attempt === 0) {
        messages.push(
          { role: "assistant", content: extracted.raw || "(empty response)" },
          { role: "user", content: `Your output failed validation: ${error}. Fix it and return the corrected output.` },
        );
        continue;
      }
      return fail("invalid_output", error);
    }
    return fail("internal", "unreachable: retry loop exited");
  }

  return { model, edit };
}

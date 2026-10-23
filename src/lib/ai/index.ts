/**
 * AI module (CONTRACTS §5) — public entry.
 *
 * `createAiService` is what the /api/ai routes call; `AiEditRequestSchema`
 * validates their JSON body; `httpStatusFor` maps a result to a status code;
 * `resolveModel` backs /api/ai/status. The validators are exported for the
 * editor's Code tab, which can run the same checks on hand-written layer code
 * before applying it. `SYSTEM_PROMPT` / `buildMessages` are exported for the
 * Claude Desktop bridge, which hands the same brief to a Claude session.
 */
export {
  type AiClient,
  type AiService,
  type AiServiceOptions,
  createAiService,
  finalizeOutput,
  httpStatusFor,
  resolveModel,
} from "./service";
export { type AiEditRequestInput, type AiOutput, AiEditRequestSchema, AiOutputSchema, ProjectSchema } from "./schema";
export { SYSTEM_PROMPT, buildMessages } from "./prompts";
export { findDisallowedImports, findForbiddenCalls, validateAiOutput } from "./validate";

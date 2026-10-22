/**
 * AI module (CONTRACTS §5) — public entry.
 *
 * `createAiService` is what the /api/ai routes call; `AiEditRequestSchema`
 * validates their JSON body; `httpStatusFor` maps a result to a status code;
 * `resolveModel` backs /api/ai/status. The validators are exported for the
 * editor's Code tab, which can run the same checks on hand-written layer code
 * before applying it. Prompt builders stay internal to `./prompts`.
 */
export {
  type AiClient,
  type AiService,
  type AiServiceOptions,
  createAiService,
  httpStatusFor,
  resolveModel,
} from "./service";
export { type AiEditRequestInput, type AiOutput, AiEditRequestSchema } from "./schema";
export { findDisallowedImports, findForbiddenCalls, validateAiOutput } from "./validate";

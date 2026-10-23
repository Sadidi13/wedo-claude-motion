/**
 * Claude Desktop bridge (docs/CLAUDE-DESKTOP.md) — public entry for the
 * /api/bridge routes. The editor and a Claude session talk through a small
 * file-backed queue: the editor shares its project and queues Ask Claude
 * requests; the `motion-bridge` CLI (run by Claude) claims and answers them,
 * and pushes new scenes / edits that the editor picks up as events.
 */
export {
  BRIDGE_ID_PATTERN,
  BridgeStateError,
  TOKEN_HEADER,
  bridgeStatus,
  bridgeToken,
  claimNextRequest,
  createRequest,
  eventsAfter,
  finishRequest,
  isValidBridgeId,
  isValidToken,
  readEvent,
  readRequest,
  readSyncedProject,
  syncProject,
  toView,
  touchEditor,
  type BridgeRequestRecord,
  type SyncedProject,
} from "./store";
export {
  BridgePushSchema,
  BridgeResultSchema,
  buildBrief,
  completeRequest,
  pushEdit,
  pushNewScene,
  type BridgePush,
  type PushResult,
} from "./operations";

import { TOKEN_HEADER, isValidToken } from "./store";

/** 401 response unless the request carries the bridge token (CLI-only routes). */
export async function requireToken(request: Request): Promise<Response | null> {
  if (await isValidToken(request.headers.get(TOKEN_HEADER))) return null;
  return Response.json(
    { error: `Missing or wrong ${TOKEN_HEADER} header; use scripts/motion-bridge.mjs, which reads the token for you` },
    { status: 401 },
  );
}

/** Parse a JSON body; null when it is not JSON. */
export async function readJsonBody(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export const NO_STORE = { "Cache-Control": "no-store" } as const;

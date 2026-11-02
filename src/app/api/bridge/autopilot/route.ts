/**
 * GET /api/bridge/autopilot — the background autopilot's state (AutopilotInfo); `?log=<n>` adds the
 * last n lines of its log (at most 200) as `log`.
 * POST /api/bridge/autopilot `{ action: "start" | "stop" | "sign-in" | "update" }` — "update" runs
 * `claude update` (a model that needs a newer Claude Code). Start it (the server
 * spawns scripts/motion-autopilot.mjs without a window), stop it with any Claude Code run it
 * started, or open a terminal that signs Claude Code in. Local-only like every /api route
 * (src/proxy.ts); see src/lib/server/bridge/autopilot.ts.
 */
import { connection, type NextRequest } from "next/server";
import { NO_STORE } from "@/lib/server/bridge";
import { autopilotInfo, autopilotLogTail, openSignIn, startAutopilot, stopAutopilot, updateClaudeCode } from "@/lib/server/bridge/autopilot";

export async function GET(request: NextRequest): Promise<Response> {
  await connection();
  const info = await autopilotInfo();
  const lines = Number(request.nextUrl.searchParams.get("log") ?? 0);
  if (!Number.isInteger(lines) || lines <= 0) return Response.json(info, { headers: NO_STORE });
  return Response.json({ ...info, log: await autopilotLogTail(Math.min(lines, 200)) }, { headers: NO_STORE });
}

export async function POST(request: NextRequest): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  try {
    switch (body?.action) {
      case "start":
        return Response.json(await startAutopilot(), { headers: NO_STORE });
      case "stop":
        return Response.json(await stopAutopilot(), { headers: NO_STORE });
      case "sign-in":
        return Response.json(openSignIn(), { headers: NO_STORE });
      case "update":
        return Response.json(await updateClaudeCode(), { headers: NO_STORE });
      default:
        return Response.json({ error: 'Send { "action": "start" | "stop" | "sign-in" | "update" }' }, { status: 400 });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

/**
 * GET /api/bridge/status — is a Claude session listening, how many requests
 * wait, which project the editor last shared, and which bridge instance this
 * is (the tools use it to find their own server). Polled by the editor, so it
 * also keeps server.json current when the startup hook could not record it.
 */
import { connection, type NextRequest } from "next/server";
import { NO_STORE, bridgeStatus } from "@/lib/server/bridge";
import { bridgeInstanceId, listeningPort, recordServerPort } from "@/lib/server/bridge/server-info";

export async function GET(request: NextRequest): Promise<Response> {
  await connection();
  const port = listeningPort() ?? Number(request.nextUrl.port || (request.nextUrl.protocol === "https:" ? 443 : 80));
  await recordServerPort(port).catch(() => undefined);
  return Response.json({ ...(await bridgeStatus()), instance: bridgeInstanceId() }, { headers: NO_STORE });
}

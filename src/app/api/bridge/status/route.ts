/**
 * GET /api/bridge/status — is a Claude session listening, how many requests
 * wait, which project the editor last shared. Polled by the editor.
 */
import { connection } from "next/server";
import { NO_STORE, bridgeStatus } from "@/lib/server/bridge";

export async function GET(): Promise<Response> {
  await connection();
  return Response.json(await bridgeStatus(), { headers: NO_STORE });
}

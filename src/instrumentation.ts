/**
 * Runs once when the server starts: record where it listens, so the Claude tools find it even
 * when Next.js moved off port 3000 (see src/lib/server/bridge/server-info.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { listeningPort, recordServerPort } = await import("@/lib/server/bridge/server-info");
  const port = listeningPort();
  if (port !== null) await recordServerPort(port).catch((error: unknown) => console.warn("[bridge] could not record the server port:", error));
}

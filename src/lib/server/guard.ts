/**
 * Local-only request guard, applied to every request by src/proxy.ts.
 *
 * WeDo Claude Motion is a local app: its API starts Chromium and ffmpeg, spends the Anthropic API
 * key when one is set, and queues work for Claude. So it only answers requests that come from this
 * machine's own editor or from local tools:
 *
 * 1. Host allowlist (blocks DNS rebinding, where evil.example resolves to 127.0.0.1 and the page
 *    would otherwise be same-origin with the API): Host must be localhost, 127.0.0.1 or [::1]
 *    (any port), or a name listed in MOTION_STUDIO_ALLOWED_HOSTS.
 * 2. No cross-site requests to /api (blocks CSRF from any web page the user visits): browsers send
 *    Sec-Fetch-Site and Origin; anything other than same-origin (or "none", a typed URL) is refused.
 *    Local tools (CLI, MCP connector, autopilot, curl) send neither and pass; the routes that act
 *    for Claude also require the bridge token.
 * 3. Writes to /api must be JSON (forces a CORS preflight for any cross-origin attempt) and at most
 *    MAX_API_BODY_BYTES by Content-Length.
 */

export const MAX_API_BODY_BYTES = 64 * 1024 * 1024;

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface GuardInput {
  method: string;
  /** request path, e.g. "/api/export" */
  pathname: string;
  /** Host header (hostname[:port]) */
  host: string | null;
  origin: string | null;
  secFetchSite: string | null;
  contentType: string | null;
  contentLength: string | null;
  /** extra allowed hostnames (MOTION_STUDIO_ALLOWED_HOSTS, comma separated) */
  allowedHosts?: string;
}

export type GuardResult = { ok: true } | { ok: false; status: number; error: string };

/** "localhost:3000" → "localhost"; "[::1]:3000" → "[::1]". */
export function hostnameOf(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith("[")) return trimmed.slice(0, trimmed.indexOf("]") + 1);
  return trimmed.split(":")[0];
}

export function isAllowedHost(host: string | null, allowedHosts = ""): boolean {
  if (!host) return false;
  const name = hostnameOf(host);
  if (LOCAL_HOSTNAMES.has(name)) return true;
  return allowedHosts
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    .includes(name);
}

function sameOrigin(origin: string, host: string): boolean {
  try {
    return new URL(origin).host.toLowerCase() === host.trim().toLowerCase();
  } catch {
    return false;
  }
}

export function checkRequest(input: GuardInput): GuardResult {
  if (!isAllowedHost(input.host, input.allowedHosts)) {
    return { ok: false, status: 403, error: "This server only answers on localhost" };
  }
  if (!input.pathname.startsWith("/api/")) return { ok: true };

  const site = input.secFetchSite?.toLowerCase();
  if (site && site !== "same-origin" && site !== "none") {
    return { ok: false, status: 403, error: "Cross-site requests are not allowed" };
  }
  if (input.origin && input.origin !== "null" && !sameOrigin(input.origin, input.host ?? "")) {
    return { ok: false, status: 403, error: "Cross-origin requests are not allowed" };
  }
  if (input.origin === "null") {
    return { ok: false, status: 403, error: "Requests from opaque origins are not allowed" };
  }

  const method = input.method.toUpperCase();
  if (WRITE_METHODS.has(method)) {
    const length = Number(input.contentLength ?? "0");
    if (Number.isFinite(length) && length > MAX_API_BODY_BYTES) {
      return { ok: false, status: 413, error: `Request body larger than ${MAX_API_BODY_BYTES / 1024 / 1024} MB` };
    }
    const hasBody = Number.isFinite(length) && length > 0;
    const type = (input.contentType ?? "").split(";")[0].trim().toLowerCase();
    if (hasBody && type !== "application/json") {
      return { ok: false, status: 415, error: "Request body must be application/json" };
    }
  }
  return { ok: true };
}

/** Headers added to every response: no framing by other sites, no MIME sniffing, no referrer leaks. */
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "frame-ancestors 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

/**
 * Runs before every request: the local-only guard (src/lib/server/guard.ts) and security headers.
 * Keep this file thin; the decisions live in the guard so they are unit-tested.
 */
import { NextResponse, type NextRequest } from "next/server";
import { SECURITY_HEADERS, checkRequest } from "@/lib/server/guard";

export function proxy(request: NextRequest) {
  const verdict = checkRequest({
    method: request.method,
    pathname: request.nextUrl.pathname,
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    contentType: request.headers.get("content-type"),
    contentLength: request.headers.get("content-length"),
    allowedHosts: process.env.MOTION_STUDIO_ALLOWED_HOSTS,
  });
  const response = verdict.ok ? NextResponse.next() : NextResponse.json({ error: verdict.error }, { status: verdict.status });
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  return response;
}

export const config = {
  // Everything except Next's own build assets (those are static and carry no side effects).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

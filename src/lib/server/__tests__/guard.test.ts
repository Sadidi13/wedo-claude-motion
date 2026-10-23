import { describe, expect, it } from "vitest";
import { type GuardInput, MAX_API_BODY_BYTES, checkRequest, hostnameOf, isAllowedHost } from "../guard";

const base: GuardInput = {
  method: "GET",
  pathname: "/api/bridge/status",
  host: "localhost:3000",
  origin: null,
  secFetchSite: null,
  contentType: null,
  contentLength: null,
};

const check = (overrides: Partial<GuardInput>) => checkRequest({ ...base, ...overrides });

describe("hosts", () => {
  it("parses hostnames with ports and IPv6 brackets", () => {
    expect(hostnameOf("localhost:3000")).toBe("localhost");
    expect(hostnameOf("[::1]:3000")).toBe("[::1]");
    expect(hostnameOf("127.0.0.1")).toBe("127.0.0.1");
  });

  it("allows only loopback names unless configured", () => {
    expect(isAllowedHost("localhost:3000")).toBe(true);
    expect(isAllowedHost("127.0.0.1:3000")).toBe(true);
    expect(isAllowedHost("[::1]:3000")).toBe(true);
    expect(isAllowedHost("192.168.1.20:3000")).toBe(false);
    expect(isAllowedHost("evil.example:3000")).toBe(false);
    expect(isAllowedHost(null)).toBe(false);
    expect(isAllowedHost("studio.lan:3000", "studio.lan, other")).toBe(true);
  });

  it("refuses DNS-rebinding hosts for pages and API alike", () => {
    expect(check({ host: "evil.example:3000", pathname: "/" })).toMatchObject({ ok: false, status: 403 });
    expect(check({ host: "evil.example:3000" })).toMatchObject({ ok: false, status: 403 });
  });
});

describe("cross-site requests", () => {
  it("lets the editor (same-origin) and local tools (no browser headers) through", () => {
    expect(check({ secFetchSite: "same-origin", origin: "http://localhost:3000", method: "POST", contentType: "application/json", contentLength: "10" })).toEqual({ ok: true });
    expect(check({ method: "POST", contentType: "application/json", contentLength: "10" })).toEqual({ ok: true });
    expect(check({ secFetchSite: "none" })).toEqual({ ok: true });
  });

  it("blocks CSRF from other sites, including text/plain simple requests", () => {
    expect(check({ secFetchSite: "cross-site", origin: "https://evil.example", method: "POST", contentType: "text/plain", contentLength: "10" })).toMatchObject({ ok: false, status: 403 });
    expect(check({ secFetchSite: "same-site", origin: "http://localhost:4000", method: "POST" })).toMatchObject({ ok: false, status: 403 });
    expect(check({ origin: "https://evil.example", method: "POST", contentType: "application/json", contentLength: "10" })).toMatchObject({ ok: false, status: 403 });
    expect(check({ origin: "null", method: "POST" })).toMatchObject({ ok: false, status: 403 });
  });

  it("does not apply the cross-site rule to pages (links into the editor still work)", () => {
    expect(check({ pathname: "/", secFetchSite: "cross-site" })).toEqual({ ok: true });
  });
});

describe("request bodies", () => {
  it("requires JSON for writes with a body", () => {
    expect(check({ method: "POST", contentType: "text/plain", contentLength: "10" })).toMatchObject({ ok: false, status: 415 });
    expect(check({ method: "PUT", contentType: "application/json; charset=utf-8", contentLength: "10" })).toEqual({ ok: true });
    expect(check({ method: "DELETE" })).toEqual({ ok: true });
  });

  it("caps the size", () => {
    expect(check({ method: "PUT", contentType: "application/json", contentLength: String(MAX_API_BODY_BYTES + 1) })).toMatchObject({ ok: false, status: 413 });
  });
});

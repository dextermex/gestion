import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * The session is a cookie, so a request that changes something must come
 * from this application's own pages. One rule (`originAllowed`), reached by
 * every route: through `withOrg`, `withOrgAndClient`, `withTenant` and
 * `billingRoute`, or directly by the routes that authenticate by themselves.
 */
let requestHeaders: Record<string, string> | null = { host: "app.morada.lu", "x-forwarded-proto": "https" };
vi.mock("next/headers", () => ({
  headers: async () => {
    if (!requestHeaders) throw new Error("`headers` was called outside a request scope.");
    return new Headers(requestHeaders);
  },
}));
vi.mock("@/lib/supabase/server", () => ({ getSession: vi.fn(async () => null), authedClient: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ getIdentity: vi.fn(async () => null) }));
vi.mock("@/lib/billing/gate", () => ({ refuseWhenLocked: vi.fn(async () => null) }));

import { originAllowed, refuseCrossOrigin, refuseCrossOriginHere, withOrg, withOrgAndClient } from "@/lib/gestion/api";
import { withTenant } from "@/lib/portal/session";
import { getSession } from "@/lib/supabase/server";

const APP = "https://app.morada.lu";
const statusOf = (r: unknown) => (r instanceof NextResponse ? r.status : 200);
const req = (method: string, headers: Record<string, string> = {}, url = `${APP}/api/x`) => new NextRequest(url, { method, headers: { host: "app.morada.lu", "x-forwarded-proto": "https", ...headers } });

beforeEach(() => {
  vi.clearAllMocks();
  requestHeaders = { host: "app.morada.lu", "x-forwarded-proto": "https" };
});

describe("the same-origin rule", () => {
  it("accepts a request without an Origin header only when it reads", () => {
    for (const method of ["GET", "HEAD", "get"]) expect(originAllowed(method, null, [APP]), method).toBe(true);
    for (const method of ["POST", "PATCH", "PUT", "DELETE", "OPTIONS"]) expect(originAllowed(method, null, [APP]), method).toBe(false);
    expect(originAllowed("POST", "", [APP])).toBe(false);
  });

  it("accepts this application's own origin and no other, whatever the method", () => {
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      expect(originAllowed(method, APP, [APP]), method).toBe(true);
      for (const other of ["https://morada.lu", "https://www.morada.lu", "https://pro.morada.lu", "https://app.morada.lu.evil.test", "https://evil.test", "http://app.morada.lu", "https://app.morada.lu:8443", "null"]) {
        expect(originAllowed(method, other, [APP]), `${method} ${other}`).toBe(false);
      }
    }
  });
});

describe("a route that holds its request", () => {
  it("lets this application's own pages through", () => {
    expect(refuseCrossOrigin(req("POST", { origin: APP }))).toBeNull();
    expect(refuseCrossOrigin(req("DELETE", { origin: APP }))).toBeNull();
    expect(refuseCrossOrigin(req("GET"))).toBeNull();
  });

  it("answers 403 to a sibling host, to another site, to a sandboxed page and to a write that names no origin", async () => {
    for (const origin of ["https://morada.lu", "https://www.morada.lu", "https://evil.test", "null", "http://app.morada.lu"]) {
      const refused = refuseCrossOrigin(req("POST", { origin }));
      expect(refused?.status, origin).toBe(403);
      expect(await refused?.json()).toEqual({ error: "forbidden", reason: "origin" });
    }
    expect(refuseCrossOrigin(req("POST"))?.status).toBe(403);
    expect(refuseCrossOrigin(req("PATCH"))?.status).toBe(403);
    expect(refuseCrossOrigin(req("GET", { origin: "https://evil.test" }))?.status).toBe(403);
  });

  it("is not moved by a host the caller names in a header of its own", () => {
    // The platform sets the forwarded host; a page elsewhere cannot add headers to a form post.
    expect(refuseCrossOrigin(req("POST", { origin: "https://evil.test", host: "app.morada.lu" }))?.status).toBe(403);
  });

  it("matches a browser on a loopback address, where the framework rewrites the request's own address", () => {
    // NextRequest names 127.0.0.1 "localhost"; the browser's Origin says 127.0.0.1, as the Host header does.
    const local = (origin: string) => new NextRequest("http://127.0.0.1:4321/api/x", { method: "POST", headers: { host: "127.0.0.1:4321", origin } });
    expect(refuseCrossOrigin(local("http://127.0.0.1:4321"))).toBeNull();
    expect(refuseCrossOrigin(local("http://localhost:4321"))).toBeNull();
    expect(refuseCrossOrigin(local("http://127.0.0.1:9999"))?.status).toBe(403);
    expect(refuseCrossOrigin(local("http://evil.test"))?.status).toBe(403);
  });
});

describe("the shared spines", () => {
  it("refuse a write or an act without this application's origin before reading any session", async () => {
    for (const spine of [() => withOrg("write"), () => withOrg("act"), () => withOrgAndClient("write"), () => withOrgAndClient("act"), () => withTenant()]) {
      requestHeaders = { host: "app.morada.lu", "x-forwarded-proto": "https" };
      expect(statusOf(await spine())).toBe(403);
      requestHeaders = { host: "app.morada.lu", "x-forwarded-proto": "https", origin: "https://morada.lu" };
      expect(statusOf(await spine())).toBe(403);
    }
    expect(getSession).not.toHaveBeenCalled();
  });

  it("go on to the session when the request comes from this application", async () => {
    requestHeaders = { host: "app.morada.lu", "x-forwarded-proto": "https", origin: APP };
    for (const spine of [() => withOrg("write"), () => withOrg("act"), () => withOrgAndClient("write"), () => withTenant()]) expect(statusOf(await spine())).toBe(401);
    expect(getSession).toHaveBeenCalledTimes(4);
  });

  it("let a read through without an Origin header, and refuse one that names another origin", async () => {
    requestHeaders = { host: "app.morada.lu", "x-forwarded-proto": "https" };
    expect(statusOf(await withOrg())).toBe(401);
    expect(statusOf(await withOrg("read"))).toBe(401);
    expect(statusOf(await withOrgAndClient())).toBe(401);
    expect(statusOf(await withTenant("read"))).toBe(401);
    requestHeaders = { host: "app.morada.lu", "x-forwarded-proto": "https", origin: "https://evil.test" };
    expect(statusOf(await withOrg())).toBe(403);
    expect(statusOf(await withTenant("read"))).toBe(403);
  });

  it("refuse when no request is in progress, outside a test run", async () => {
    requestHeaders = null;
    expect(await refuseCrossOriginHere(true)).toBeNull(); // a unit test calling a spine directly
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect((await refuseCrossOriginHere(true))?.status).toBe(403);
      expect((await refuseCrossOriginHere(false))?.status).toBe(403);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("every route that changes something", () => {
  const API = path.resolve(__dirname, "../../app/api");
  const routes = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? routes(full) : name === "route.ts" ? [full] : [];
  });
  // What reaches the rule: a spine that is a write or an act, the tenant spine, the billing spine, or the helper itself.
  const GUARD = /withOrg\("(write|act)"\)|withOrgAndClient\("(write|act)"\)|withTenant\(\)|withTenant\("write"\)|billingRoute\(|refuseCrossOrigin\(/;

  it("passes the same-origin rule, handler by handler", () => {
    const files = routes(API);
    expect(files.length).toBeGreaterThan(70);
    const unguarded: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const handlers = source.split(/(?=export async function (?:GET|HEAD|POST|PUT|PATCH|DELETE)\b)/).filter((part) => /^export async function (POST|PUT|PATCH|DELETE)\b/.test(part));
      for (const handler of handlers) {
        if (!GUARD.test(handler)) unguarded.push(`${path.relative(API, file)} ${handler.slice(22, 30).trim()}`);
      }
    }
    expect(unguarded).toEqual([]);
  });
});

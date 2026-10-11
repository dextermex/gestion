import { describe, expect, it } from "vitest";
import { originAllowed, originOf, requestOrigin } from "@/lib/origin";

/**
 * The Origin rule of the route wrappers: the session cookie sits on
 * `.morada.lu`, so only this application's own origin may act with it; no
 * Origin (navigation, same-origin GET, server to server) passes; "null"
 * and every other site, sibling subdomains included, are refused.
 */
const APP = "https://app.morada.lu";

describe("the origin rule", () => {
  it("accepts the application's own origin, however it is spelled", () => {
    expect(originAllowed("https://app.morada.lu", [APP])).toBe(true);
    expect(originAllowed("https://APP.morada.lu", [APP])).toBe(true);
    expect(originAllowed("https://app.morada.lu", [null, "https://app.morada.lu/"])).toBe(true);
  });

  it("lets a request without an Origin through", () => {
    expect(originAllowed(null, [APP])).toBe(true);
    expect(originAllowed(undefined, [APP])).toBe(true);
    expect(originAllowed("", [APP])).toBe(true);
  });

  it("refuses sibling subdomains, other sites, other schemes and ports, and null", () => {
    for (const o of ["https://morada.lu", "https://www.morada.lu", "https://evil.morada.lu", "https://app.morada.lu.evil.com", "http://app.morada.lu", "https://app.morada.lu:8443", "null", "file://", "not a url"]) {
      expect(originAllowed(o, [APP]), o).toBe(false);
    }
  });

  it("accepts a preview deployment's own origin when the request was addressed to it", () => {
    const own = requestOrigin((h) => ({ host: "gestion-git-x.vercel.app", "x-forwarded-proto": "https" })[h] ?? null);
    expect(own).toBe("https://gestion-git-x.vercel.app");
    expect(originAllowed("https://gestion-git-x.vercel.app", [APP, own])).toBe(true);
    expect(originAllowed("https://other.vercel.app", [APP, own])).toBe(false);
  });

  it("reads the addressed origin from the proxy's headers, then the Host", () => {
    expect(requestOrigin((h) => ({ "x-forwarded-host": "app.morada.lu, internal", "x-forwarded-proto": "https,http", host: "internal" })[h] ?? null)).toBe("https://app.morada.lu");
    expect(requestOrigin((h) => ({ host: "localhost:3000" })[h] ?? null)).toBe("http://localhost:3000");
    expect(requestOrigin(() => null)).toBeNull();
    expect(originOf("null")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import config, { SECURITY_HEADERS } from "../../../next.config";

/**
 * Every answer carries the headers that tell a browser who may frame the
 * application, not to guess a file's type, what a link out says of where it
 * came from and to come back over HTTPS; the framework's name is not sent.
 */
describe("the headers every answer carries", () => {
  it("are applied to every path", async () => {
    expect(config.poweredByHeader).toBe(false);
    const rules = await config.headers!();
    const all = rules.find((r) => r.source === "/:path*");
    expect(all).toBeDefined();
    const byName = new Map(all!.headers.map((h) => [h.key.toLowerCase(), h.value]));
    expect(byName.get("x-content-type-options")).toBe("nosniff");
    expect(byName.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(byName.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(byName.get("strict-transport-security")).toMatch(/^max-age=\d{8,}/);
    expect(byName.get("permissions-policy")).toContain("camera=()");
  });

  it("let the application frame itself (the bank journey) and nobody else, with no script policy that would need a nonce", () => {
    const csp = SECURITY_HEADERS.find((h) => h.key === "Content-Security-Policy")!.value;
    const directives = new Map(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values.join(" ")]));
    expect(directives.get("frame-ancestors")).toBe("'self'");
    expect(directives.get("object-src")).toBe("'none'");
    expect(directives.get("base-uri")).toBe("'self'");
    expect(directives.has("script-src")).toBe(false);
    expect(directives.has("default-src")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { REQUESTED_PATH_HEADER, requestedPath, signInAddress } from "@/lib/auth/return-path";
import { config, middleware } from "@/middleware";
import { INVITATION_COOKIE, isInvitationToken, tokenOfPath } from "@/lib/auth/invitation-token";

/**
 * Signing in returns to the page that was asked for: the middleware names
 * the address for the two spaces, the layouts send the visitor to the door
 * with it, and the door only ever follows a path of this application.
 */
const nextOf = (address: string) => new URL(address, "https://app.morada.lu").searchParams.get("next");

describe("the way back after signing in", () => {
  it("keeps the page and its query", () => {
    expect(nextOf(signInAddress("/app/messages?demande=7f3c", "app"))).toBe("/app/messages?demande=7f3c");
    expect(nextOf(signInAddress("/app/abonnement", "app"))).toBe("/app/abonnement");
    expect(nextOf(signInAddress("/locataire/bail", "locataire"))).toBe("/locataire/bail");
    expect(signInAddress("/app", "app")).toBe("/connexion?next=%2Fapp");
  });

  it("falls back to the space's home without a header", () => {
    expect(nextOf(signInAddress(null, "app"))).toBe("/app");
    expect(nextOf(signInAddress(undefined, "locataire"))).toBe("/locataire");
    expect(nextOf(signInAddress("", "app"))).toBe("/app");
  });

  it("never leaves this application, whatever the header carried", () => {
    for (const raw of ["https://evil.test/app", "//evil.test/app", "/\\evil.test", "/app/../../connexion", "/connexion?next=/app", "javascript:alert(1)", "/app\n/x", "/app/%2f%2fevil.test", "/api/compte"]) {
      const next = nextOf(signInAddress(raw, "app")) ?? "";
      expect(next.startsWith("/app"), raw).toBe(true);
      expect(next.includes("evil"), raw).toBe(false);
      expect(new URL(next, "https://app.morada.lu").origin, raw).toBe("https://app.morada.lu");
    }
    // A tenant is never sent into the management space by a crafted address.
    expect(nextOf(signInAddress("/app/loyers", "locataire"))).toBe("/locataire");
  });

  it("drops the parameter the framework adds to its own data requests", () => {
    expect(requestedPath("/app/loyers", "?_rsc=1a2b3")).toBe("/app/loyers");
    expect(requestedPath("/app/messages", "?demande=7f3c&_rsc=1a2b3")).toBe("/app/messages?demande=7f3c");
    expect(requestedPath("/locataire", "")).toBe("/locataire");
  });
});

describe("the middleware", () => {
  const forwarded = (res: Response) => res.headers.get(`x-middleware-request-${REQUESTED_PATH_HEADER}`);

  it("names the requested address for the layout, and nothing else", () => {
    const res = middleware(new NextRequest("https://app.morada.lu/app/messages?demande=7f3c"));
    expect(forwarded(res)).toBe("/app/messages?demande=7f3c");
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("overwrites a value the caller sent", () => {
    const res = middleware(new NextRequest("https://app.morada.lu/locataire/bail", { headers: { [REQUESTED_PATH_HEADER]: "https://evil.test/" } }));
    expect(forwarded(res)).toBe("/locataire/bail");
  });

  it("runs on the two spaces and the invitation link only: never on an API route, the door or a file", () => {
    expect(config.matcher).toEqual(["/app/:path*", "/locataire/:path*", "/invitation/:token"]);
  });
});

describe("the invitation link", () => {
  const TOKEN = "Qx3_aZ09-".repeat(5) + "k";

  it("leaves its token in a cookie only the server reads, on the invitation page alone, and sends the browser to an address without it", () => {
    const res = middleware(new NextRequest(`https://app.morada.lu/invitation/${TOKEN}`));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/invitation");
    expect(res.headers.get("location")).not.toContain(TOKEN);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${INVITATION_COOKIE}=${TOKEN}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\/invitation(;|$)/i);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    // Nothing is named for a layout here.
    expect(res.headers.get(`x-middleware-request-${REQUESTED_PATH_HEADER}`)).toBeNull();
  });

  it("is not Secure on a local plain-HTTP server, so the cookie still reaches the page there", () => {
    const res = middleware(new NextRequest(`http://127.0.0.1:4321/invitation/${TOKEN}`));
    expect(res.status).toBe(303);
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/Secure/i);
  });

  it("leaves an address without a token of the right shape to the page, which says the link is not valid", () => {
    for (const raw of ["short", "a%2Fb".repeat(8), "x".repeat(200)]) {
      const res = middleware(new NextRequest(`https://app.morada.lu/invitation/${raw}`));
      expect(res.status, raw).toBe(200);
      expect(res.headers.get("set-cookie"), raw).toBeNull();
    }
  });

  it("reads a token from its path only when it is one", () => {
    expect(tokenOfPath(`/invitation/${TOKEN}`)).toBe(TOKEN);
    expect(tokenOfPath(`/invitation/${TOKEN}/`)).toBe(TOKEN);
    expect(tokenOfPath("/invitation")).toBeNull();
    expect(tokenOfPath(`/invitation/${TOKEN}/x`)).toBeNull();
    expect(tokenOfPath("/invitation/%E0%A4%A")).toBeNull();
    expect(isInvitationToken(TOKEN)).toBe(true);
    expect(isInvitationToken("../../etc")).toBe(false);
  });
});

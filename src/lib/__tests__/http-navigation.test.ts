import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { answerNavigation, cameFrom, isNavigation } from "@/lib/http/navigation";

const request = (headers: Record<string, string>) => new NextRequest("https://app.morada.lu/api/documents/doc-1/fichier", { headers: { host: "app.morada.lu", ...headers } });
const json = (error: string, status: number) => Response.json({ error }, { status });
const click = { "sec-fetch-mode": "navigate", accept: "text/html,application/xhtml+xml", referer: "https://app.morada.lu/app/loyers?mois=2026-10" };

describe("a link that points at a handler", () => {
  it("leaves a script its JSON error, and a person the file", () => {
    const script = answerNavigation(request({ accept: "*/*" }), json("not_found", 404));
    expect(script.status).toBe(404);
    const ok = new Response(null, { status: 302, headers: { Location: "https://storage.example/signed" } });
    expect(answerNavigation(request(click), ok)).toBe(ok);
    // A fetch from the page itself is a script too, whatever it accepts.
    expect(isNavigation(request({ "sec-fetch-mode": "cors", accept: "text/html" }))).toBe(false);
    expect(isNavigation(request({ accept: "text/html" }))).toBe(true);
  });

  it("sends a person whose session ran out to sign in, coming back to the screen the link was on", () => {
    const res = answerNavigation(request(click), json("unauthenticated", 401));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/connexion?next=${encodeURIComponent("/app/loyers?mois=2026-10")}`);
    expect(answerNavigation(request({ "sec-fetch-mode": "navigate" }), json("unauthenticated", 401)).headers.get("location")).toBe(`/connexion?next=${encodeURIComponent("/app")}`);
  });

  it("sends every other refusal to the app's own screen, with the reason and the way back", () => {
    const at = (status: number) => new URL(answerNavigation(request(click), json("x", status)).headers.get("location")!, "https://app.morada.lu");
    expect(at(404).pathname).toBe("/app/documents/indisponible");
    expect(at(404).searchParams.get("raison")).toBe("absent");
    expect(at(404).searchParams.get("retour")).toBe("/app/loyers?mois=2026-10");
    expect(at(403).searchParams.get("raison")).toBe("refuse");
    expect(at(502).searchParams.get("raison")).toBe("echec");
    expect(at(503).searchParams.get("raison")).toBe("echec");
  });

  it("never returns to another site, nor outside the management space", () => {
    expect(cameFrom(request({ referer: "https://evil.example/app/loyers" }))).toBeNull();
    expect(cameFrom(request({ referer: "https://app.morada.lu/connexion" }))).toBeNull();
    expect(cameFrom(request({ referer: "https://app.morada.lu/application" }))).toBeNull();
    expect(cameFrom(request({ referer: "not a url" }))).toBeNull();
    expect(cameFrom(request({ referer: "https://app.morada.lu/app" }))).toBe("/app");
  });
});

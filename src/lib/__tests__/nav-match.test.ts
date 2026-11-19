import { describe, expect, it } from "vitest";
import { inSection } from "@/lib/nav-match";

describe("inSection", () => {
  const settings = ["/app/reglages", "/app/abonnement", "/app/utilisateurs", "/app/integrations", "/app/compte"];
  it("matches a section's own address and what sits under it", () => {
    expect(inSection("/app/compte", settings)).toBe(true);
    expect(inSection("/app/reglages", settings)).toBe(true);
    expect(inSection("/app/baux/b-12", ["/app/biens", "/app/baux"])).toBe(true);
  });
  it("does not take a longer word for the section it starts with", () => {
    expect(inSection("/app/compteurs", settings)).toBe(false);
    expect(inSection("/app/financement/simulateur", ["/app/finance"])).toBe(false);
    expect(inSection("/app/financement/simulateur", ["/app/finance", "/app/financement"])).toBe(true);
  });
});

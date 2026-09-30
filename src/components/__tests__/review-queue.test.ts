import { describe, expect, it } from "vitest";
import { BIND_SUGGESTION_SCORE, initialRowState } from "@/components/gestion/ReviewQueue";

const candidate = (score: number) => ({ leaseId: "l-rdc", label: `Studio RDC · score ${Math.round(score * 100)} %`, score });

describe("the review queue's starting point", () => {
  it("starts on nothing when the engine has no candidate: the manager names the lease", () => {
    const s = initialRowState({ candidates: [], payerIban: "LU770040004444333322" });
    expect(s.leaseId).toBe("");
    expect(s.learn).toBe(false);
  });

  it("starts on the engine's best candidate, and offers to remember the IBAN behind a strong one", () => {
    const s = initialRowState({ candidates: [candidate(0.71), candidate(0.4)], payerIban: "LU770040004444333322" });
    expect(s.leaseId).toBe("l-rdc");
    expect(s.learn).toBe(true);
  });

  it("only lists a weak suggestion: nothing is preselected and the IBAN box stays unticked", () => {
    const s = initialRowState({ candidates: [candidate(BIND_SUGGESTION_SCORE - 0.01)], payerIban: "LU770040004444333322" });
    expect(s.leaseId).toBe("");
    expect(s.learn).toBe(false);
  });

  it("never offers to remember an IBAN the bank did not give", () => {
    const s = initialRowState({ candidates: [candidate(0.9)], payerIban: null });
    expect(s.learn).toBe(false);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { adjustmentBlock, adjustmentBlockedText, leaseIssueText } from "@/lib/i18n/engine";
import { computeCapitalInvesti, proposeResidentialAdjustment } from "@/domain/indexation/engine";
import { validateLeaseDraft } from "@/domain/lease/rules";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";
import { de } from "@/lib/i18n/de";
import { lu } from "@/lib/i18n/lu";
import type { Dict } from "@/lib/i18n/fr";
import type { Locale } from "@/lib/i18n/config";

/**
 * Engines answer in stable codes and keep an English note for themselves.
 * What a screen prints comes from the code, in the reader's language: the
 * note never reaches it.
 */
const dicts: Array<[Locale, Dict]> = [
  ["fr", fr],
  ["en", en],
  ["de", de],
  ["lu", lu],
];

describe("lease rule issues", () => {
  // Every code the rule engine can raise, read from its source: a new rule without a translation fails here.
  const source = readFileSync(path.resolve(__dirname, "../../../domain/lease/rules.ts"), "utf8");
  const codes = [...new Set([...source.matchAll(/code: "([A-Z0-9_]+)"/g)].map((m) => m[1]))];

  it("have a sentence in each of the four languages", () => {
    expect(codes.length).toBeGreaterThan(8);
    for (const [locale, d] of dicts) {
      for (const code of codes) {
        expect((d.legal.leaseIssue as Record<string, string>)[code], `${locale}.${code}`).toBeTruthy();
      }
    }
  });

  it("are printed from the code, never from the engine's English note", () => {
    const issues = validateLeaseDraft({
      type: "residential",
      startDate: "2026-01-01",
      endDate: null,
      monthlyRent: 150000,
      monthlyCharges: 20000,
      depositForm: "cash",
      depositMonths: 3,
      mentions: {},
      hasCpiEscalationClause: true,
      furnished: false,
      colocation: false,
    });
    expect(issues.map((i) => i.code)).toContain("DEPOSIT_OVER_CAP");
    for (const [locale, d] of dicts) {
      for (const i of issues) {
        const text = leaseIssueText(d, i.code, { months: 3, max: 2, date: "" }, i.message);
        expect(text, `${locale}.${i.code}`).not.toBe(i.message);
        expect(text).not.toMatch(/\{\w+\}/);
        expect(text).not.toMatch(/[—→]/);
      }
    }
    expect(leaseIssueText(fr, "DEPOSIT_OVER_CAP", { months: 3, max: 2 }, "Deposit of 3 months exceeds the legal maximum.")).toBe(
      "La garantie de 3 mois dépasse le plafond légal de 2 mois pour ce type de bail.",
    );
  });

  it("read as a point to check, by code, when the dictionaries do not know the code yet", () => {
    const note = "Some new rule fired — see the statute.";
    for (const [, d] of dicts) {
      const text = leaseIssueText(d, "A_RULE_FROM_TOMORROW", {}, note);
      expect(text).not.toBe(note);
      expect(text).toContain("A_RULE_FROM_TOMORROW");
    }
  });
});

describe("a residential adjustment the engine refuses", () => {
  const capital = (amount: number) => computeCapitalInvesti([{ year: 2015, amount, kind: "construction" }], "2026-11-19");
  const propose = (over: Partial<Parameters<typeof proposeResidentialAdjustment>[0]>) =>
    proposeResidentialAdjustment({
      currentMonthlyRent: 150000,
      lastAdjustmentDate: null,
      leaseStartDate: "2020-01-01",
      proposedDate: "2026-11-19",
      capital: capital(60_000_000),
      ...over,
    });

  it("is told from the proposal's structure: too soon, with the next lawful date", () => {
    const p = propose({ lastAdjustmentDate: "2026-04-01" });
    expect(p.allowed).toBe(false);
    expect(adjustmentBlock(p)).toBe("too_soon");
    expect(adjustmentBlockedText(fr, "fr", p, "2026-11-19")).toBe(
      "Un ajustement n'est permis qu'une fois tous les 24 mois. Le prochain sera possible à partir du 1 avr. 2028.",
    );
  });

  it("is told from the proposal's structure: the rent is at the legal ceiling", () => {
    const p = propose({ capital: capital(1_000_000) });
    expect(p.allowed).toBe(false);
    expect(adjustmentBlock(p)).toBe("at_ceiling");
    expect(adjustmentBlockedText(fr, "fr", p, "2026-11-19")).toBe("Le loyer atteint déjà le plafond légal de 5 % du capital investi.");
  });

  it("never prints the engine's own sentence, in any language", () => {
    for (const p of [propose({ lastAdjustmentDate: "2026-04-01" }), propose({ capital: capital(1_000_000) })]) {
      for (const [locale, d] of dicts) {
        const text = adjustmentBlockedText(d, locale, p, "2026-11-19");
        expect(text.length, locale).toBeGreaterThan(10);
        expect(text).not.toBe(p.blockedReason);
        expect(text).not.toMatch(/[—→]/);
        expect(text).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it("has nothing to say about an adjustment that is allowed", () => {
    const p = propose({});
    expect(p.allowed).toBe(true);
    expect(adjustmentBlock(p)).toBeNull();
    expect(adjustmentBlockedText(fr, "fr", p, "2026-11-19")).toBe("");
  });
});

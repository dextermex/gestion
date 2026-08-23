/**
 * AML/KYC engine (loi 12.11.2004; AED supervision — fiscal brief §8).
 *
 * Two-tier onboarding:
 *  • LIGHT — ordinary residential tenants (rent < €10,000/month).
 *  • FULL CDD — auto-triggered on: sale mandates · letting mandates with
 *    monthly rent ≥ €10,000 · any cash movement ≥ €10,000 (single or linked)
 *    · any non-natural-person counterparty.
 *
 * Owner onboarding is where the real risk sits: SCI/foreign-company owners
 * require UBO resolution (> 25%), RBE cross-check and PEP/sanctions
 * screening. Retention: 5 years from END of relationship (per-document-class
 * clocks, not account-level). Whether pure managers/syndics are in scope is
 * [U] — the default tier is configurable so counsel can flip it.
 */

import { Cents } from "@/domain/money";
import { ISODate, addYears } from "@/domain/dates";
import { getParamValue } from "@/domain/legal/params";

export type CddTier = "light" | "full_cdd";
export type RiskBand = "low" | "medium" | "high";

export interface AmlTriggerInput {
  relationship: "letting_mandate" | "sale_mandate" | "tenancy" | "vendor";
  monthlyRent: Cents | null;
  counterpartyIsLegalEntity: boolean;
  cashMovements: Cents[];
  /** Linked cash transactions are aggregated. */
  onDate: ISODate;
}

export interface AmlTriggerResult {
  tier: CddTier;
  triggers: string[];
}

export function resolveCddTier(input: AmlTriggerInput): AmlTriggerResult {
  const triggers: string[] = [];
  const rentThreshold = getParamValue("aml.letting_monthly_rent_threshold_eur", input.onDate) * 100;
  const cashThreshold = getParamValue("aml.cash_threshold_eur", input.onDate) * 100;

  if (input.relationship === "sale_mandate") {
    triggers.push("Sale mandate — agents immobiliers are obliged entities for purchase and sale.");
  }
  if (
    (input.relationship === "letting_mandate" || input.relationship === "tenancy") &&
    input.monthlyRent !== null &&
    input.monthlyRent >= rentThreshold
  ) {
    triggers.push(`Letting with monthly rent ≥ €${rentThreshold / 100} — in AML scope.`);
  }
  const cashTotal = input.cashMovements.reduce((a, b) => a + b, 0);
  if (cashTotal >= cashThreshold) {
    triggers.push(`Cash movements of €${(cashTotal / 100).toFixed(0)} (single or linked) ≥ €${cashThreshold / 100}.`);
  }
  if (input.counterpartyIsLegalEntity) {
    triggers.push("Non-natural-person counterparty — UBO resolution and RBE cross-check required.");
  }

  return { tier: triggers.length > 0 ? "full_cdd" : "light", triggers };
}

export interface RiskFactorInput {
  countryRisk: "low" | "medium" | "high";
  clientType: "natural_resident" | "natural_non_resident" | "legal_lux" | "legal_foreign";
  isPep: boolean;
  complexOwnership: boolean;
  cashIntensive: boolean;
}

export interface RiskAssessment {
  band: RiskBand;
  score: number;
  factors: string[];
  /** Periodic review interval by band. */
  nextReviewMonths: number;
}

export function assessRisk(input: RiskFactorInput): RiskAssessment {
  let score = 0;
  const factors: string[] = [];
  const add = (points: number, label: string) => {
    score += points;
    factors.push(`${label} (+${points})`);
  };

  if (input.countryRisk === "medium") add(2, "Medium-risk country");
  if (input.countryRisk === "high") add(4, "High-risk country");
  if (input.clientType === "natural_non_resident") add(1, "Non-resident natural person");
  if (input.clientType === "legal_lux") add(1, "Luxembourg legal entity");
  if (input.clientType === "legal_foreign") add(3, "Foreign legal entity");
  if (input.isPep) add(4, "Politically exposed person — enhanced due diligence");
  if (input.complexOwnership) add(2, "Complex ownership chain");
  if (input.cashIntensive) add(2, "Cash-intensive pattern");

  const band: RiskBand = score >= 6 ? "high" : score >= 3 ? "medium" : "low";
  return {
    band,
    score,
    factors,
    nextReviewMonths: band === "high" ? 12 : band === "medium" ? 24 : 36,
  };
}

export interface UboNode {
  name: string;
  sharePct: number;
  isNaturalPerson: boolean;
  children?: UboNode[];
}

export interface UboResolution {
  ubos: Array<{ name: string; effectivePct: number }>;
  thresholdPct: number;
  complete: boolean;
  issues: string[];
}

/**
 * Walk the ownership chain multiplying shares; natural persons whose
 * effective share exceeds the 25% threshold are UBOs. Chains ending in a
 * legal entity without children are flagged incomplete.
 */
export function resolveUbo(root: UboNode[], onDate: ISODate): UboResolution {
  const threshold = getParamValue("aml.ubo_threshold_pct", onDate);
  const acc = new Map<string, number>();
  const issues: string[] = [];
  let complete = true;

  const walk = (nodes: UboNode[], factor: number) => {
    for (const n of nodes) {
      const eff = (factor * n.sharePct) / 100;
      if (n.isNaturalPerson) {
        acc.set(n.name, (acc.get(n.name) ?? 0) + eff * 100);
      } else if (n.children && n.children.length > 0) {
        walk(n.children, eff);
      } else {
        complete = false;
        issues.push(`Chain ends at legal entity “${n.name}” — obtain its shareholder register / RBE extract.`);
      }
    }
  };
  walk(root, 1);

  const ubos = [...acc.entries()]
    .filter(([, p]) => p > threshold)
    .map(([name, effectivePct]) => ({ name, effectivePct: Math.round(effectivePct * 100) / 100 }))
    .sort((a, b) => b.effectivePct - a.effectivePct);

  if (ubos.length === 0 && complete) {
    issues.push("No natural person above the threshold — apply the senior-managing-official fallback.");
  }
  return { ubos, thresholdPct: threshold, complete, issues };
}

/** AML retention clock: 5 years from END of relationship — never from onboarding. */
export function amlRetentionUntil(relationshipEndedAt: ISODate): ISODate {
  const years = getParamValue("aml.retention_years_from_end_of_relationship", relationshipEndedAt);
  return addYears(relationshipEndedAt, years);
}

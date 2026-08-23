/**
 * Translate engine outputs for the UI. Domain engines return STABLE CODES
 * (issue codes, deduction statuses, regime reasons) plus English internal
 * notes; the UI renders from the codes through the active dictionary and
 * never parses the English prose.
 */

import { fmt, type Locale } from "./config";
import type { Dict } from "./fr";
import { formatDate, formatPct } from "@/lib/types";
import { getParamValue } from "@/domain/legal/params";
import type { SettlementInput, SettlementResult } from "@/domain/deposits/settlement";

/** Lease-rule issue text by code, with template vars; falls back to the engine message. */
export function leaseIssueText(
  d: Dict,
  code: string,
  vars: Record<string, string | number> = {},
  fallback = "",
): string {
  const template = (d.legal.leaseIssue as Record<string, string>)[code];
  return template ? fmt(template, vars) : fallback;
}

/**
 * Localized settlement warnings, derived from the engine's structured result
 * (line statuses, penalty months, tranche dates) — mirrors settlement.ts.
 */
export function settlementNotes(
  d: Dict,
  locale: Locale,
  input: Pick<SettlementInput, "entryEdlExists" | "deductions" | "releasedFirstTranche" | "asOf">,
  s: SettlementResult,
): string[] {
  const notes: string[] = [];
  if (!input.entryEdlExists && input.deductions.some((l) => l.kind === "damage")) {
    notes.push(d.legal.settlement.warnNoEdl);
  }
  for (const line of s.lines) {
    if (line.status === "expired_forfeited") {
      notes.push(fmt(d.legal.settlement.warnExpired, { label: line.label }));
    } else if (line.status === "pending" && line.justificationDeadline) {
      notes.push(
        fmt(d.legal.settlement.warnPending, {
          label: line.label,
          date: formatDate(line.justificationDeadline, locale),
        }),
      );
    }
  }
  if (s.penaltyMonths > 0) {
    const pct = getParamValue("residential.deposit_penalty_pct_of_monthly_rent_per_month", input.asOf);
    notes.push(fmt(d.legal.settlement.warnPenalty, { n: s.penaltyMonths, pct }));
  } else if (input.releasedFirstTranche < s.firstTrancheAmount && input.asOf > s.firstTrancheDueAt) {
    notes.push(
      fmt(d.legal.settlement.warnTrancheOverdue, { date: formatDate(s.firstTrancheDueAt, locale) }),
    );
  }
  return notes;
}

/** Amortisation regime explanation from its reason code. */
export function amortReasonText(
  d: Dict,
  reason: string,
  vars: Record<string, string | number> = {},
): string {
  const template = (d.legal.amortReason as Record<string, string>)[reason];
  return template ? fmt(template, vars) : "";
}

/** Energy-renovation amortisation explanation from its reason code. */
export function energyReasonText(
  d: Dict,
  reason: string,
  vars: Record<string, string | number> = {},
): string {
  const template = (d.legal.energyReason as Record<string, string>)[reason];
  return template ? fmt(template, vars) : "";
}

export { fmt, formatPct };

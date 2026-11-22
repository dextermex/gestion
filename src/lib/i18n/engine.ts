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
import type { AdjustmentProposal } from "@/domain/indexation/engine";

/**
 * Lease-rule issue text by code, with template vars. The engine's own note is
 * English and internal: it is accepted here so callers can keep passing it,
 * and it is never printed. A code the dictionaries do not know yet reads as a
 * point to check, by its code, in the reader's language.
 */
export function leaseIssueText(
  d: Dict,
  code: string,
  vars: Record<string, string | number> = {},
  engineNote?: string,
): string {
  void engineNote;
  const template = (d.legal.leaseIssue as Record<string, string>)[code];
  return template ? fmt(template, vars) : fmt(d.legal.leaseIssueUnknown, { code });
}

/** Why the indexation engine proposes nothing, as a stable code read from its structured result. */
export type AdjustmentBlock = "too_soon" | "at_ceiling" | "none";

export function adjustmentBlock(p: Pick<AdjustmentProposal, "allowed" | "nextAllowedDate" | "bindingConstraint">): AdjustmentBlock | null {
  if (p.allowed) return null;
  // The interval rule is the only refusal that names a next date; the ceiling is the only one that binds on it.
  if (p.nextAllowedDate) return "too_soon";
  return p.bindingConstraint === "ceiling" ? "at_ceiling" : "none";
}

/**
 * The sentence for a refused residential adjustment, from the proposal's
 * structure (next lawful date, binding cap) and the legal parameters in force
 * on `onDate`: never from the engine's English `blockedReason`.
 */
export function adjustmentBlockedText(
  d: Dict,
  locale: Locale,
  p: Pick<AdjustmentProposal, "allowed" | "nextAllowedDate" | "bindingConstraint">,
  onDate: string,
): string {
  const block = adjustmentBlock(p);
  if (!block) return "";
  if (block === "too_soon") {
    return fmt(d.legal.adjustmentBlocked.too_soon, {
      months: getParamValue("residential.rent_adjustment_min_interval_months", onDate),
      date: formatDate(p.nextAllowedDate ?? onDate, locale),
    });
  }
  if (block === "at_ceiling") {
    return fmt(d.legal.adjustmentBlocked.at_ceiling, { pct: getParamValue("residential.rent_ceiling_pct_of_capital", onDate) });
  }
  return d.legal.adjustmentBlocked.none;
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

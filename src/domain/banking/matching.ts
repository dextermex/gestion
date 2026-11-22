/**
 * Payment-recognition cascade (strategy §4.3). Design goal: >90% auto-match
 * at steady state without touching funds.
 *
 * Pre-classifiers  → non-rent counterparties · INDEXATION_LAG · multi-invoice
 *                    subset-sum (≤ 6 open invoices)
 * Tier 1           → RF deterministic (checksum-validated, exact)
 * Tier 2           → learned payer-IBAN bindings (the only tier that saves
 *                    third-party payers: parents, employers, housing subsidies)
 * Tier 3           → weighted fuzzy: IBAN 0.45 · amount 0.25/0.20/0.12 ·
 *                    reference tokens 0.20 · Jaro-Winkler name 0.15 · date 0.10.
 *                    Auto-post at ≥ 0.85 with a ≥ 0.15 margin over the
 *                    runner-up — the margin rule is what saves two identical
 *                    €1,450 studios in one building.
 *
 * Paid-ness is always DERIVED from the allocation ledger, never a boolean:
 * partials allocate FIFO and leave the residual open; overpayments become
 * tenant credit; every auto-post is reversible and audited.
 */

import { Cents } from "@/domain/money";
import { ISODate, diffDays } from "@/domain/dates";
import { extractRF, findKnownRF } from "@/domain/banking/rf";
import { detectIndexationLag } from "@/domain/indexation/engine";

export interface BankTransaction {
  id: string;
  bookedAt: ISODate;
  amount: Cents;
  counterpartyName: string;
  counterpartyIban: string | null;
  remittanceInfo: string;
  endToEndId: string | null;
}

export interface OpenInvoice {
  id: string;
  leaseId: string;
  tenantNames: string[];
  rfReference: string;
  dueDate: ISODate;
  totalAmount: Cents;
  openAmount: Cents;
  /** Previous rent before the last adjustment (INDEXATION_LAG detection). */
  previousRentAmount: Cents | null;
  unitLabel: string;
}

export interface IbanBinding {
  payerIban: string;
  leaseId: string;
}

export type MatchDecision =
  | {
      kind: "auto";
      tier: "rf" | "iban_binding" | "fuzzy" | "subset_sum";
      invoiceIds: string[];
      confidence: number;
      margin: number | null;
      indexationLag: { shortfall: Cents } | null;
      explain: string;
    }
  | {
      kind: "review";
      candidates: Array<{ invoiceId: string; score: number; explain: string }>;
      reason: string;
      suggestBinding: { payerIban: string; leaseId: string } | null;
    }
  | { kind: "ignore"; reason: string };

export interface MatchConfig {
  autoPostThreshold: number;
  minMargin: number;
  subsetSumMaxInvoices: number;
  /**
   * A bank operation and a payment typed by hand are the same money when
   * they sit on the same tenancy, carry the same amount and are this many
   * days apart at most: the operation is then attached to that payment
   * instead of being posted a second time.
   */
  manualTwinDays: number;
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  autoPostThreshold: 0.85,
  minMargin: 0.15,
  subsetSumMaxInvoices: 6,
  manualTwinDays: 10,
};

// ─── Jaro-Winkler ───────────────────────────────────────────────────────────

export function jaroWinkler(s1: string, s2: string): number {
  const a = s1.toUpperCase();
  const b = s2.toUpperCase();
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const matchWindow = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array(a.length).fill(false);
  const bMatch = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - matchWindow);
    const hi = Math.min(b.length - 1, i + matchWindow);
    for (let j = lo; j <= hi; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const jaro =
    (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
  // Winkler prefix boost (up to 4 chars, p=0.1)
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

// ─── Tier 3 scoring ─────────────────────────────────────────────────────────

export interface FuzzyScore {
  invoiceId: string;
  score: number;
  parts: Record<string, number>;
  explain: string;
}

export function scoreFuzzy(
  tx: BankTransaction,
  invoice: OpenInvoice,
  knownIbans: Set<string>,
): FuzzyScore {
  const parts: Record<string, number> = {};

  // IBAN 0.45 — payer IBAN previously seen on this lease.
  parts.iban = tx.counterpartyIban && knownIbans.has(tx.counterpartyIban) ? 0.45 : 0;

  // Amount 0.25 exact / 0.20 within 2% / 0.12 within 10%.
  const diff = Math.abs(tx.amount - invoice.openAmount);
  if (diff === 0) parts.amount = 0.25;
  else if (diff <= invoice.openAmount * 0.02) parts.amount = 0.2;
  else if (diff <= invoice.openAmount * 0.1) parts.amount = 0.12;
  else parts.amount = 0;

  // Reference tokens 0.20 — unit label / lease tokens in the remittance text.
  const remit = tx.remittanceInfo.toUpperCase();
  const tokens = invoice.unitLabel
    .toUpperCase()
    .split(/[\s\-/,.]+/)
    .filter((t) => t.length >= 3);
  const tokenHit = tokens.some((t) => remit.includes(t));
  parts.reference = tokenHit ? 0.2 : 0;

  // Name 0.15 × best Jaro-Winkler across tenants.
  const bestName = invoice.tenantNames.reduce(
    (best, name) => Math.max(best, jaroWinkler(tx.counterpartyName, name)),
    0,
  );
  parts.name = 0.15 * bestName;

  // Date 0.10 — within 10 days of the due date, linear decay.
  const dd = Math.abs(diffDays(invoice.dueDate, tx.bookedAt));
  parts.date = dd <= 10 ? 0.1 * (1 - dd / 10) : 0;

  const score = Object.values(parts).reduce((a, b) => a + b, 0);
  const explain = Object.entries(parts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}=${v.toFixed(2)}`)
    .join(" ");
  return { invoiceId: invoice.id, score, parts, explain };
}

// ─── Subset-sum pre-classifier ──────────────────────────────────────────────

/**
 * A landlord's multi-unit tenant (or an employer paying several rents) sends
 * ONE transfer covering several invoices. Find a subset of ≤ maxN open
 * invoices for the same payer scope summing exactly to the amount.
 */
export function findSubsetSum(
  amount: Cents,
  invoices: OpenInvoice[],
  maxN: number,
): OpenInvoice[] | null {
  const n = Math.min(invoices.length, 20); // bound the search space
  const items = invoices.slice(0, n);
  let best: OpenInvoice[] | null = null;
  const walk = (idx: number, remaining: Cents, chosen: OpenInvoice[]) => {
    if (best) return;
    if (remaining === 0 && chosen.length >= 2) {
      best = [...chosen];
      return;
    }
    if (idx >= items.length || chosen.length >= maxN || remaining < 0) return;
    walk(idx + 1, remaining - items[idx].openAmount, [...chosen, items[idx]]);
    walk(idx + 1, remaining, chosen);
  };
  walk(0, amount, []);
  return best;
}

// ─── The cascade ────────────────────────────────────────────────────────────

export function matchTransaction(
  tx: BankTransaction,
  openInvoices: OpenInvoice[],
  bindings: IbanBinding[],
  leaseKnownIbans: Map<string, Set<string>>,
  config: MatchConfig = DEFAULT_MATCH_CONFIG,
): MatchDecision {
  // Outgoing or zero amounts are not rent.
  if (tx.amount <= 0) {
    return { kind: "ignore", reason: "Outgoing or zero amount — not a rent receipt." };
  }

  // Tier 1 — deterministic RF. The reference names the tenancy, not a
  // month: the amount goes FIFO to its oldest open periods, like any other
  // receipt, so a late payer's transfer clears the oldest debt first.
  // A reference this workspace issued is recognised as itself, wherever it
  // sits in the text; only failing that is the text scanned for any valid one.
  const text = `${tx.remittanceInfo} ${tx.endToEndId ?? ""}`;
  const known = findKnownRF(text, openInvoices.map((i) => i.rfReference));
  const rf = known.length === 1 ? known[0] : known.length > 1 ? null : (extractRF(tx.remittanceInfo) ?? extractRF(tx.endToEndId ?? ""));
  if (known.length > 1) {
    // Two tenancies named in one transfer: a person decides how it splits.
    return {
      kind: "review",
      candidates: known.map((ref) => ({ invoiceId: openInvoices.filter((i) => i.rfReference === ref).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0].id, score: 1, explain: `rf=${ref}` })),
      reason: `Remittance names ${known.length} lease references.`,
      suggestBinding: null,
    };
  }
  if (rf) {
    const hits = openInvoices.filter((i) => i.rfReference === rf).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    if (hits.length > 0) {
      const lag = detectIndexationLag(tx.amount, hits[0].totalAmount, hits[0].previousRentAmount);
      return {
        kind: "auto",
        tier: "rf",
        invoiceIds: allocateFifo(tx.amount, hits).map((a) => a.invoiceId),
        confidence: 1,
        margin: null,
        indexationLag: lag ? { shortfall: lag.shortfall } : null,
        explain: `RF reference ${rf} — deterministic match.`,
      };
    }
  }

  // Tier 2 — learned payer-IBAN binding (saves third-party payers). One
  // account may pay several tenancies (a flat and its parking, a parent or
  // an employer paying for two tenants): the binding then names several
  // leases, and the amount has to say which one, or the transfer waits for a
  // person. It is never handed to whichever binding happens to come first.
  if (tx.counterpartyIban) {
    const payerLeases = [...new Set(bindings.filter((b) => b.payerIban === tx.counterpartyIban).map((b) => b.leaseId))];
    const openOf = (leaseId: string) => openInvoices.filter((i) => i.leaseId === leaseId).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1)); // FIFO
    const withOpen = payerLeases.filter((leaseId) => openOf(leaseId).length > 0);
    const bound = (leaseId: string): MatchDecision => {
      const leaseInvoices = openOf(leaseId);
      const lag = detectIndexationLag(tx.amount, leaseInvoices[0].totalAmount, leaseInvoices[0].previousRentAmount);
      return {
        kind: "auto",
        tier: "iban_binding",
        invoiceIds: allocateFifo(tx.amount, leaseInvoices).map((a) => a.invoiceId),
        confidence: 0.95,
        margin: null,
        indexationLag: lag ? { shortfall: lag.shortfall } : null,
        explain: `Known payer IBAN bound to lease ${leaseId} — FIFO allocation.`,
      };
    };
    if (withOpen.length === 1) return bound(withOpen[0]);
    if (withOpen.length > 1) {
      // The amount decides: exactly one of the payer's tenancies owes this
      // amount on its oldest open period, or as the sum of its open periods.
      const exact = withOpen.filter((leaseId) => {
        const open = openOf(leaseId);
        return open[0].openAmount === tx.amount || open.reduce((a, i) => a + i.openAmount, 0) === tx.amount;
      });
      if (exact.length === 1) return bound(exact[0]);
      // One transfer covering several invoices across those tenancies.
      const pool = openInvoices.filter((i) => withOpen.includes(i.leaseId));
      const subset = findSubsetSum(tx.amount, pool, config.subsetSumMaxInvoices);
      if (subset) {
        return {
          kind: "auto",
          tier: "subset_sum",
          invoiceIds: subset.map((i) => i.id),
          confidence: 0.92,
          margin: null,
          indexationLag: null,
          explain: `One transfer covering ${subset.length} open invoices (exact subset-sum).`,
        };
      }
      return {
        kind: "review",
        candidates: withOpen.map((leaseId) => ({ invoiceId: openOf(leaseId)[0].id, score: 0.95, explain: "iban_binding" })),
        reason: `Payer IBAN bound to ${withOpen.length} leases and the amount names none of them alone.`,
        suggestBinding: null,
      };
    }
  }

  // Tier 3 — weighted fuzzy with the margin rule.
  const scored = openInvoices
    .map((i) => scoreFuzzy(tx, i, leaseKnownIbans.get(i.leaseId) ?? new Set()))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { kind: "review", candidates: [], reason: "No open invoices to match against.", suggestBinding: null };
  }

  // The margin rule tells two tenancies apart (two identical studios in one
  // building). Two open months of the same tenancy are not rivals: the next
  // month is always open at the same amount, with the same names and the
  // same IBAN, and would otherwise hold every ordinary rent in review.
  const top = scored[0];
  const leaseOf = (invoiceId: string): string => openInvoices.find((i) => i.id === invoiceId)?.leaseId ?? "";
  const topLease = leaseOf(top.invoiceId);
  const runnerUp = scored.find((sc) => leaseOf(sc.invoiceId) !== topLease);
  const margin = runnerUp ? top.score - runnerUp.score : top.score;

  if (top.score >= config.autoPostThreshold && margin >= config.minMargin) {
    const inv = openInvoices.find((i) => i.id === top.invoiceId)!;
    const lag = detectIndexationLag(tx.amount, inv.totalAmount, inv.previousRentAmount);
    return {
      kind: "auto",
      tier: "fuzzy",
      invoiceIds: [top.invoiceId],
      confidence: top.score,
      margin,
      indexationLag: lag ? { shortfall: lag.shortfall } : null,
      explain: `Fuzzy ${top.score.toFixed(2)} (margin ${margin.toFixed(2)}): ${top.explain}`,
    };
  }

  return {
    kind: "review",
    candidates: scored.slice(0, 5).map((s) => ({ invoiceId: s.invoiceId, score: s.score, explain: s.explain })),
    reason:
      top.score >= config.autoPostThreshold
        ? `Top score ${top.score.toFixed(2)} but margin ${margin.toFixed(2)} < ${config.minMargin} — two candidates too close (identical rents?).`
        : `Best score ${top.score.toFixed(2)} below the ${config.autoPostThreshold} auto-post threshold.`,
    suggestBinding:
      tx.counterpartyIban && top.score >= 0.45
        ? {
            payerIban: tx.counterpartyIban,
            leaseId: openInvoices.find((i) => i.id === top.invoiceId)!.leaseId,
          }
        : null,
  };
}

// ─── Allocation ledger ──────────────────────────────────────────────────────

export interface Allocation {
  invoiceId: string;
  amount: Cents;
}

/**
 * FIFO allocation: oldest invoice first, partials leave a residual open,
 * excess becomes tenant credit (returned as `credit`).
 */
export function allocateFifo(
  amount: Cents,
  invoices: OpenInvoice[],
): Allocation[] {
  const sorted = [...invoices].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const out: Allocation[] = [];
  let left = amount;
  for (const inv of sorted) {
    if (left <= 0) break;
    const take = Math.min(left, inv.openAmount);
    if (take > 0) {
      out.push({ invoiceId: inv.id, amount: take });
      left -= take;
    }
  }
  return out;
}

export function allocationSummary(amount: Cents, allocations: Allocation[]): {
  allocated: Cents;
  credit: Cents;
} {
  const allocated = allocations.reduce((a, x) => a + x.amount, 0);
  return { allocated, credit: Math.max(0, amount - allocated) };
}

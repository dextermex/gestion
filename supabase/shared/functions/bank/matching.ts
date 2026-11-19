/**
 * Payment-recognition cascade, ported from app.morada.lu
 * (src/domain/banking/matching.ts, rf.ts, indexation/engine.ts), so a
 * transfer imported from the phone is matched exactly as one imported on
 * the web. Paid-ness is derived from allocations, never a boolean.
 *
 * Tier 1  RF deterministic (ISO 11649, checksum-validated)
 * Tier 2  learned payer-IBAN bindings, with a subset-sum for one transfer
 *         covering several open periods
 * Tier 3  weighted fuzzy; auto-post at >= 0.85 with a >= 0.15 margin
 */
export interface BankTransaction { id: string; bookedAt: string; amount: number; counterpartyName: string; counterpartyIban: string | null; remittanceInfo: string; endToEndId: string | null }
export interface OpenInvoice { id: string; leaseId: string; tenantNames: string[]; rfReference: string; dueDate: string; totalAmount: number; openAmount: number; previousRentAmount: number | null; unitLabel: string }
export interface IbanBinding { payerIban: string; leaseId: string }
export type MatchDecision =
  | { kind: "auto"; tier: "rf" | "iban_binding" | "fuzzy" | "subset_sum"; invoiceIds: string[]; confidence: number; margin: number | null; indexationLag: { shortfall: number } | null; explain: string }
  | { kind: "review"; candidates: { invoiceId: string; score: number; explain: string }[]; reason: string; suggestBinding: { payerIban: string; leaseId: string } | null }
  | { kind: "ignore"; reason: string };
export interface MatchConfig { autoPostThreshold: number; minMargin: number; subsetSumMaxInvoices: number }
export const DEFAULT_MATCH_CONFIG: MatchConfig = { autoPostThreshold: 0.85, minMargin: 0.15, subsetSumMaxInvoices: 6 };

function mod97(input: string): number {
  let remainder = 0;
  for (const ch of input) {
    const code = /[0-9]/.test(ch) ? ch : String(ch.toUpperCase().charCodeAt(0) - 55);
    for (const digit of code) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
}
export function isValidRF(ref: string): boolean {
  const clean = ref.toUpperCase().replace(/\s/g, "");
  if (!/^RF\d{2}[0-9A-Z]{1,21}$/.test(clean)) return false;
  return mod97(clean.slice(4) + clean.slice(0, 4)) === 1;
}
export function extractRF(text: string): string | null {
  const compact = text.toUpperCase().replace(/[\s.-]/g, "");
  const matches = compact.match(/RF\d{2}[0-9A-Z]{1,21}/g);
  if (!matches) return null;
  for (const m of [...matches].sort((a, b) => b.length - a.length)) {
    for (let end = m.length; end >= 5; end--) {
      const candidate = m.slice(0, end);
      if (isValidRF(candidate)) return candidate;
    }
  }
  return null;
}
export function diffDays(a: string, b: string): number {
  const ta = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const tb = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((tb - ta) / 86_400_000);
}
export function detectIndexationLag(received: number, currentRent: number, previousRent: number | null): { shortfall: number } | null {
  if (previousRent === null) return null;
  if (received === previousRent && previousRent < currentRent) return { shortfall: currentRent - previousRent };
  return null;
}
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
  const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}
export function scoreFuzzy(tx: BankTransaction, invoice: OpenInvoice, knownIbans: Set<string>) {
  const parts: Record<string, number> = {};
  parts.iban = tx.counterpartyIban && knownIbans.has(tx.counterpartyIban) ? 0.45 : 0;
  const diff = Math.abs(tx.amount - invoice.openAmount);
  parts.amount = diff === 0 ? 0.25 : diff <= invoice.openAmount * 0.02 ? 0.2 : diff <= invoice.openAmount * 0.1 ? 0.12 : 0;
  const remit = tx.remittanceInfo.toUpperCase();
  const tokens = invoice.unitLabel.toUpperCase().split(/[\s\-/,.]+/).filter((t) => t.length >= 3);
  parts.reference = tokens.some((t) => remit.includes(t)) ? 0.2 : 0;
  const bestName = invoice.tenantNames.reduce((best, name) => Math.max(best, jaroWinkler(tx.counterpartyName, name)), 0);
  parts.name = 0.15 * bestName;
  const dd = Math.abs(diffDays(invoice.dueDate, tx.bookedAt));
  parts.date = dd <= 10 ? 0.1 * (1 - dd / 10) : 0;
  const score = Object.values(parts).reduce((a, b) => a + b, 0);
  const explain = Object.entries(parts).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(" ");
  return { invoiceId: invoice.id, score, parts, explain };
}
export function findSubsetSum(amount: number, invoices: OpenInvoice[], maxN: number): OpenInvoice[] | null {
  const items = invoices.slice(0, Math.min(invoices.length, 20));
  let best: OpenInvoice[] | null = null;
  const walk = (idx: number, remaining: number, chosen: OpenInvoice[]) => {
    if (best) return;
    if (remaining === 0 && chosen.length >= 2) { best = [...chosen]; return; }
    if (idx >= items.length || chosen.length >= maxN || remaining < 0) return;
    walk(idx + 1, remaining - items[idx].openAmount, [...chosen, items[idx]]);
    walk(idx + 1, remaining, chosen);
  };
  walk(0, amount, []);
  return best;
}
export interface Allocation { invoiceId: string; amount: number }
export function allocateFifo(amount: number, invoices: OpenInvoice[]): Allocation[] {
  const sorted = [...invoices].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const out: Allocation[] = [];
  let left = amount;
  for (const inv of sorted) {
    if (left <= 0) break;
    const take = Math.min(left, inv.openAmount);
    if (take > 0) { out.push({ invoiceId: inv.id, amount: take }); left -= take; }
  }
  return out;
}
export function matchTransaction(tx: BankTransaction, openInvoices: OpenInvoice[], bindings: IbanBinding[], leaseKnownIbans: Map<string, Set<string>>, config: MatchConfig = DEFAULT_MATCH_CONFIG): MatchDecision {
  if (tx.amount <= 0) return { kind: "ignore", reason: "Outgoing or zero amount." };
  const rf = extractRF(tx.remittanceInfo) ?? extractRF(tx.endToEndId ?? "");
  if (rf) {
    const hits = openInvoices.filter((i) => i.rfReference === rf).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    if (hits.length > 0) {
      const lag = detectIndexationLag(tx.amount, hits[0].totalAmount, hits[0].previousRentAmount);
      return { kind: "auto", tier: "rf", invoiceIds: allocateFifo(tx.amount, hits).map((a) => a.invoiceId), confidence: 1, margin: null, indexationLag: lag, explain: `RF ${rf}` };
    }
  }
  if (tx.counterpartyIban) {
    const binding = bindings.find((b) => b.payerIban === tx.counterpartyIban);
    if (binding) {
      const leaseInvoices = openInvoices.filter((i) => i.leaseId === binding.leaseId).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
      if (leaseInvoices.length > 0) {
        const lag = detectIndexationLag(tx.amount, leaseInvoices[0].totalAmount, leaseInvoices[0].previousRentAmount);
        return { kind: "auto", tier: "iban_binding", invoiceIds: allocateFifo(tx.amount, leaseInvoices).map((a) => a.invoiceId), confidence: 0.95, margin: null, indexationLag: lag, explain: `IBAN binding ${binding.leaseId}` };
      }
    }
    const payerLeases = new Set(bindings.filter((b) => b.payerIban === tx.counterpartyIban).map((b) => b.leaseId));
    if (payerLeases.size > 0) {
      const subset = findSubsetSum(tx.amount, openInvoices.filter((i) => payerLeases.has(i.leaseId)), config.subsetSumMaxInvoices);
      if (subset) return { kind: "auto", tier: "subset_sum", invoiceIds: subset.map((i) => i.id), confidence: 0.92, margin: null, indexationLag: null, explain: `subset of ${subset.length}` };
    }
  }
  const scored = openInvoices.map((i) => scoreFuzzy(tx, i, leaseKnownIbans.get(i.leaseId) ?? new Set())).sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { kind: "review", candidates: [], reason: "No open invoices to match against.", suggestBinding: null };
  const top = scored[0];
  const runnerUp = scored[1];
  const margin = runnerUp ? top.score - runnerUp.score : top.score;
  if (top.score >= config.autoPostThreshold && margin >= config.minMargin) {
    const inv = openInvoices.find((i) => i.id === top.invoiceId)!;
    return { kind: "auto", tier: "fuzzy", invoiceIds: [top.invoiceId], confidence: top.score, margin, indexationLag: detectIndexationLag(tx.amount, inv.totalAmount, inv.previousRentAmount), explain: `Fuzzy ${top.score.toFixed(2)} (margin ${margin.toFixed(2)}): ${top.explain}` };
  }
  return {
    kind: "review",
    candidates: scored.slice(0, 5).map((s) => ({ invoiceId: s.invoiceId, score: s.score, explain: s.explain })),
    reason: top.score >= config.autoPostThreshold ? `Top score ${top.score.toFixed(2)} but margin ${margin.toFixed(2)} < ${config.minMargin}.` : `Best score ${top.score.toFixed(2)} below ${config.autoPostThreshold}.`,
    suggestBinding: tx.counterpartyIban && top.score >= 0.45 ? { payerIban: tx.counterpartyIban, leaseId: openInvoices.find((i) => i.id === top.invoiceId)!.leaseId } : null,
  };
}

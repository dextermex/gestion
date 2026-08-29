import type { SeAccount, SeTransaction } from "@/lib/banking/saltedge";

/**
 * Pure mapping from Salt Edge payloads to gestion.* rows — kept separate from
 * the route so money conversions are unit-tested. Amounts arrive as decimal
 * euros; the ledger only ever stores integer cents.
 */

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function mapAccountRow(a: SeAccount, orgId: string, connectionId: string, nowIso: string) {
  return {
    org_id: orgId,
    label: a.extra?.account_name || a.name || "Compte",
    iban: a.extra?.iban ?? a.extra?.bban ?? "",
    holder_name_verbatim: a.extra?.client_name ?? "",
    kind: "operating" as const,
    provider: "salt_edge" as const,
    provider_connection_id: connectionId,
    provider_account_id: a.id,
    balance_cents: toCents(a.balance),
    last_synced_at: nowIso,
  };
}

export function mapTransactionRow(t: SeTransaction, orgId: string, bankAccountId: string) {
  return {
    org_id: orgId,
    bank_account_id: bankAccountId,
    booked_on: t.made_on,
    amount_cents: toCents(t.amount),
    currency: t.currency_code || "EUR",
    // Rent receipts are credits, so the payer is the counterparty that
    // matters; debits fall back to the payee.
    counterparty_name: (t.amount >= 0 ? t.extra?.payer : t.extra?.payee) ?? t.extra?.payer ?? t.extra?.payee ?? "",
    remittance_info: t.description ?? "",
    end_to_end_id: t.extra?.end_to_end_id ?? null,
    bank_tx_id: t.id,
    match_status: "unmatched" as const,
  };
}

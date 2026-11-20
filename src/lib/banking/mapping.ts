import type { SeAccount, SeTransaction } from "@/lib/banking/saltedge";
import { ibanChecks } from "@/domain/banking/iban";

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

/**
 * The counterparty's account, when the provider gives it: Salt Edge carries
 * it, depending on the bank, as `account_number`, inside `payer` / `payee` or
 * their `_information`, or in the free `additional` text. Only a string that
 * is an IBAN by its check digits is taken; anything else stays unknown, and
 * the learned-payer tier simply does not fire.
 */
export function counterpartyIbanOf(t: SeTransaction): string | null {
  const extra = (t.extra ?? {}) as Record<string, unknown>;
  const side = t.amount >= 0 ? ["payer", "payer_information"] : ["payee", "payee_information"];
  for (const key of ["account_number", ...side, "additional", "information"]) {
    const raw = extra[key];
    if (typeof raw !== "string") continue;
    for (const token of raw.toUpperCase().match(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g) ?? []) {
      const iban = token.replace(/\s+/g, "");
      if (ibanChecks(iban)) return iban;
    }
  }
  return null;
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
    // The payer's account, for the learned-payer tier and the review queue's "remember this IBAN".
    counterparty_iban: counterpartyIbanOf(t),
    remittance_info: t.description ?? "",
    end_to_end_id: t.extra?.end_to_end_id ?? null,
    bank_tx_id: t.id,
    match_status: "unmatched" as const,
  };
}

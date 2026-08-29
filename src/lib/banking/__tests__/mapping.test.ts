import { describe, expect, it } from "vitest";
import { mapAccountRow, mapTransactionRow, toCents } from "@/lib/banking/mapping";
import type { SeAccount, SeTransaction } from "@/lib/banking/saltedge";

describe("salt edge mapping", () => {
  it("converts decimal euros to integer cents without drift", () => {
    expect(toCents(1330)).toBe(133000);
    expect(toCents(12.34)).toBe(1234);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(-1240.55)).toBe(-124055);
  });

  it("maps an account with IBAN, holder and balance", () => {
    const a: SeAccount = {
      id: "acc-1",
      connection_id: "conn-1",
      name: "Compte courant",
      balance: 48732.4,
      currency_code: "EUR",
      extra: { iban: "LU280019400644750000", client_name: "CABINET REUTER GESTION SARL" },
    };
    const row = mapAccountRow(a, "org-1", "conn-1", "2026-08-29T00:00:00Z");
    expect(row).toMatchObject({
      org_id: "org-1",
      label: "Compte courant",
      iban: "LU280019400644750000",
      holder_name_verbatim: "CABINET REUTER GESTION SARL",
      provider: "salt_edge",
      provider_connection_id: "conn-1",
      provider_account_id: "acc-1",
      balance_cents: 4873240,
    });
  });

  it("credits take the payer as counterparty, debits the payee", () => {
    const base: SeTransaction = {
      id: "tx-1",
      account_id: "acc-1",
      made_on: "2026-08-03",
      amount: 1670,
      currency_code: "EUR",
      description: "LOYER AOUT",
      extra: { payer: "JEAN MULLER", payee: "CABINET" },
    };
    expect(mapTransactionRow(base, "org-1", "ba-1")).toMatchObject({
      counterparty_name: "JEAN MULLER",
      amount_cents: 167000,
      booked_on: "2026-08-03",
      bank_tx_id: "tx-1",
      match_status: "unmatched",
    });
    const debit = { ...base, id: "tx-2", amount: -1240.55, extra: { payee: "KRIER & FILS" } };
    expect(mapTransactionRow(debit, "org-1", "ba-1")).toMatchObject({
      counterparty_name: "KRIER & FILS",
      amount_cents: -124055,
    });
  });
});

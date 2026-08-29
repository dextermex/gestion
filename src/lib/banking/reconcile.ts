import "server-only";
import {
  DEFAULT_MATCH_CONFIG,
  allocateFifo,
  matchTransaction,
  type BankTransaction,
  type IbanBinding,
  type OpenInvoice,
} from "@/domain/banking/matching";

/**
 * Runs the matching engine over the workspace's unmatched incoming
 * transactions and persists what it decides: a payment plus FIFO
 * allocations for an auto match, a review flag otherwise. Paid-ness stays
 * derived — the rent_period_status view reads the allocations.
 *
 * The client is the caller's own JWT-bound PostgREST handle; RLS decides.
 */

type Db = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

interface OpenRow {
  id: string;
  lease_id: string;
  due_date: string;
  total_cents: number;
  allocated_cents: number;
  status: string;
}

export interface ReconcileResult {
  auto: number;
  review: number;
  ignored: number;
}

export async function reconcileUnmatched(g: Db, orgId: string): Promise<ReconcileResult> {
  const out: ReconcileResult = { auto: 0, review: 0, ignored: 0 };

  const { data: txRows, error: txErr } = await g
    .from("bank_transactions")
    .select("id,booked_on,amount_cents,counterparty_name,counterparty_iban,remittance_info,end_to_end_id")
    .eq("org_id", orgId)
    .eq("match_status", "unmatched")
    .order("booked_on")
    .limit(500);
  if (txErr || !txRows?.length) return out;

  // The open side of the ledger, with the names the fuzzy tier scores on.
  const [{ data: openRows }, { data: leases }, { data: parties }, { data: contacts }, { data: units }, { data: properties }, { data: bindings }] =
    await Promise.all([
      g.from("rent_period_status").select("id,lease_id,due_date,total_cents,allocated_cents,status").eq("org_id", orgId),
      g.from("leases").select("id,unit_id,rf_reference,previous_rent_cents").eq("org_id", orgId),
      g.from("lease_parties").select("lease_id,contact_id,role").eq("org_id", orgId),
      g.from("contacts").select("id,display_name,first_name,last_name,legal_name,iban").eq("org_id", orgId),
      g.from("units").select("id,property_id,label").eq("org_id", orgId),
      g.from("properties").select("id,name").eq("org_id", orgId),
      g.from("iban_bindings").select("payer_iban,lease_id").eq("org_id", orgId),
    ]);

  type Row = Record<string, unknown>;
  const byId = (rows: unknown): Map<string, Row> =>
    new Map(((rows ?? []) as Row[]).map((r) => [String(r.id), r]));
  const contactById = byId(contacts);
  const nameOf = (c: Row | undefined): string =>
    String(c?.display_name ?? "") ||
    String(c?.legal_name ?? "") ||
    [c?.first_name, c?.last_name].filter(Boolean).join(" ");
  const unitById = byId(units);
  const propertyById = byId(properties);
  const leaseById = byId(leases);

  const tenantsByLease = new Map<string, string[]>();
  const ibansByLease = new Map<string, Set<string>>();
  for (const p of (parties ?? []) as Array<Record<string, unknown>>) {
    if (p.role !== "tenant") continue;
    const c = contactById.get(String(p.contact_id));
    const list = tenantsByLease.get(String(p.lease_id)) ?? [];
    list.push(nameOf(c));
    tenantsByLease.set(String(p.lease_id), list);
    const iban = String(c?.iban ?? "").replace(/\s/g, "");
    if (iban) {
      const set = ibansByLease.get(String(p.lease_id)) ?? new Set<string>();
      set.add(iban);
      ibansByLease.set(String(p.lease_id), set);
    }
  }
  const unitLabelOfLease = (leaseId: string): string => {
    const l = leaseById.get(leaseId);
    const u = l ? unitById.get(String(l.unit_id)) : undefined;
    const p = u ? propertyById.get(String(u.property_id)) : undefined;
    return u ? `${String(u.label)}${p ? ` · ${String(p.name)}` : ""}` : "";
  };

  const invoices: OpenInvoice[] = ((openRows ?? []) as OpenRow[])
    .filter((rp) => rp.status !== "written_off" && rp.allocated_cents < rp.total_cents)
    .map((rp) => {
      const l = leaseById.get(rp.lease_id);
      return {
        id: rp.id,
        leaseId: rp.lease_id,
        tenantNames: tenantsByLease.get(rp.lease_id) ?? [],
        rfReference: String(l?.rf_reference ?? ""),
        dueDate: rp.due_date,
        totalAmount: rp.total_cents,
        openAmount: rp.total_cents - rp.allocated_cents,
        previousRentAmount: typeof l?.previous_rent_cents === "number" ? (l.previous_rent_cents as number) : null,
        unitLabel: unitLabelOfLease(rp.lease_id),
      };
    });
  const ibanBindings: IbanBinding[] = ((bindings ?? []) as Array<Record<string, unknown>>).map((b) => ({
    payerIban: String(b.payer_iban),
    leaseId: String(b.lease_id),
  }));

  let liveInvoices = invoices;
  for (const row of txRows as Array<Record<string, unknown>>) {
    const btx: BankTransaction = {
      id: String(row.id),
      bookedAt: String(row.booked_on),
      amount: Number(row.amount_cents),
      counterpartyName: String(row.counterparty_name ?? ""),
      counterpartyIban: row.counterparty_iban ? String(row.counterparty_iban) : null,
      remittanceInfo: String(row.remittance_info ?? ""),
      endToEndId: row.end_to_end_id ? String(row.end_to_end_id) : null,
    };
    const decision = matchTransaction(btx, liveInvoices, ibanBindings, ibansByLease, DEFAULT_MATCH_CONFIG);

    if (decision.kind === "auto") {
      const targets = liveInvoices.filter((i) => decision.invoiceIds.includes(i.id));
      const allocations = allocateFifo(btx.amount, targets);
      if (allocations.length > 0) {
        const leaseId = targets[0].leaseId;
        const { data: payment, error: payErr } = await g
          .from("payments")
          .insert({
            org_id: orgId,
            lease_id: leaseId,
            bank_transaction_id: btx.id,
            received_on: btx.bookedAt,
            amount_cents: btx.amount,
            method: "transfer",
          })
          .select("id")
          .single();
        if (payErr || !payment) {
          console.error("reconcile payment insert failed:", payErr?.code, payErr?.message);
          continue;
        }
        const { error: allocErr } = await g.from("payment_allocations").insert(
          allocations.map((a) => ({
            org_id: orgId,
            payment_id: payment.id,
            rent_period_id: a.invoiceId,
            amount_cents: a.amount,
            auto: true,
          })),
        );
        if (allocErr) {
          console.error("reconcile allocation insert failed:", allocErr.code, allocErr.message);
          continue;
        }
        // Keep the in-memory open ledger truthful for the next transaction.
        const spent = new Map(allocations.map((a) => [a.invoiceId, a.amount]));
        liveInvoices = liveInvoices
          .map((i) => ({ ...i, openAmount: i.openAmount - (spent.get(i.id) ?? 0) }))
          .filter((i) => i.openAmount > 0);
      }
      // Locale-neutral shorthand: the UI's badge carries the translated tier.
      const explain =
        decision.tier === "rf"
          ? `RF ${targets[0]?.rfReference ?? ""}`
          : decision.tier === "iban_binding"
            ? `IBAN → ${targets[0]?.unitLabel ?? ""}`
            : `${decision.tier} · ${Math.round(decision.confidence * 100)} %`;
      await g
        .from("bank_transactions")
        .update({
          match_status: "auto",
          match_tier: decision.tier,
          match_confidence: decision.confidence,
          match_explain: decision.indexationLag ? `${explain} · Δ ${decision.indexationLag.shortfall}` : explain,
        })
        .eq("org_id", orgId)
        .eq("id", btx.id);
      out.auto += 1;
    } else if (decision.kind === "review") {
      await g
        .from("bank_transactions")
        .update({ match_status: "review", match_explain: decision.reason })
        .eq("org_id", orgId)
        .eq("id", btx.id);
      out.review += 1;
    } else {
      await g
        .from("bank_transactions")
        .update({ match_status: "ignored", match_explain: decision.reason })
        .eq("org_id", orgId)
        .eq("id", btx.id);
      out.ignored += 1;
    }
  }
  return out;
}

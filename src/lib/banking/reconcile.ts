import "server-only";
import {
  DEFAULT_MATCH_CONFIG,
  allocateFifo,
  matchTransaction,
  type BankTransaction,
  type IbanBinding,
  type OpenInvoice,
} from "@/domain/banking/matching";
import { isPaymentError, recordPaymentFifo } from "@/lib/banking/allocate";
import { readAll, type ReadQuery } from "@/lib/banking/read-all";

/**
 * Runs the matching engine over the workspace's unmatched incoming
 * transactions and persists what it decides: a payment with its allocations
 * for an auto match, a review flag otherwise. Paid-ness stays derived: the
 * rent_period_status view reads the allocations.
 *
 * Each post is one database transaction (`recordPaymentFifo`): the operation
 * is claimed first, so an import and a sync that overlap, or a manual match
 * crossing a run, never turn one operation into two payments, and a step
 * that fails leaves nothing behind for the next run to post again. Every
 * other verdict is written against `unmatched`, the status the run read.
 *
 * The open ledger is read whole, in pages: matching on a ledger cut at the
 * server's page size would post against the wrong month.
 *
 * The client is the caller's own JWT-bound PostgREST handle; RLS decides.
 */

type Db = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
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

/** The statuses of a period something can still be paid into. */
const OPEN_STATUSES = ["pending", "upcoming", "late", "partial", "partial_late"];

export async function reconcileUnmatched(g: Db, orgId: string): Promise<ReconcileResult> {
  const out: ReconcileResult = { auto: 0, review: 0, ignored: 0 };

  const { data: txRows, error: txErr } = await g
    .from("bank_transactions")
    .select("id,booked_on,amount_cents,currency,counterparty_name,counterparty_iban,remittance_info,end_to_end_id")
    .eq("org_id", orgId)
    .eq("match_status", "unmatched")
    .order("booked_on")
    .limit(500);
  if (txErr || !txRows?.length) return out;

  // The open side of the ledger, with the names the fuzzy tier scores on.
  const scoped = (q: ReadQuery): ReadQuery => q.eq("org_id", orgId);
  const [open, leases, parties, contacts, units, properties, bindings] = await Promise.all([
    readAll(g, "rent_period_status", "id,lease_id,due_date,total_cents,allocated_cents,status", (q) => scoped(q).in("status", OPEN_STATUSES)),
    readAll(g, "leases", "id,unit_id,rf_reference,previous_rent_cents,status", scoped),
    readAll(g, "lease_parties", "id,lease_id,contact_id,role", scoped),
    readAll(g, "contacts", "id,display_name,first_name,last_name,legal_name,iban", scoped),
    readAll(g, "units", "id,property_id,label", scoped),
    readAll(g, "properties", "id,name", scoped),
    readAll(g, "iban_bindings", "id,payer_iban,lease_id", scoped),
  ]);
  const failed = [open, leases, parties, contacts, units, properties, bindings].find((r) => r.error);
  if (failed) {
    // A partial ledger would match against the wrong months: nothing is decided on it.
    console.error("reconcile ledger read failed:", failed.error?.code, failed.error?.message);
    return out;
  }

  type Row = Record<string, unknown>;
  const byId = (rows: Row[]): Map<string, Row> => new Map(rows.map((r) => [String(r.id), r]));
  const contactById = byId(contacts.rows);
  const nameOf = (c: Row | undefined): string =>
    String(c?.display_name ?? "") ||
    String(c?.legal_name ?? "") ||
    [c?.first_name, c?.last_name].filter(Boolean).join(" ");
  const unitById = byId(units.rows);
  const propertyById = byId(properties.rows);
  const leaseById = byId(leases.rows);

  const tenantsByLease = new Map<string, string[]>();
  const ibansByLease = new Map<string, Set<string>>();
  for (const p of parties.rows) {
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

  const invoices: OpenInvoice[] = (open.rows as unknown as OpenRow[])
    // A dossier in preparation has no ledger to pay into, whatever rows it carries.
    .filter((rp) => rp.allocated_cents < rp.total_cents && leaseById.get(rp.lease_id)?.status !== "draft")
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
  const ibanBindings: IbanBinding[] = bindings.rows.map((b) => ({
    payerIban: String(b.payer_iban),
    leaseId: String(b.lease_id),
  }));

  /** A verdict other than a post, written only while the operation is still unmatched. */
  const mark = async (id: string, patch: Record<string, unknown>): Promise<boolean> => {
    const { data, error } = await g.from("bank_transactions").update(patch).eq("org_id", orgId).eq("id", id).eq("match_status", "unmatched").select("id");
    if (error) console.error("reconcile mark failed:", error.code, error.message);
    return !error && (data?.length ?? 0) > 0;
  };

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
    // The ledger is in euro cents: an operation in another currency is not
    // compared with it as if the figures meant the same thing.
    const currency = String(row.currency ?? "EUR").toUpperCase();
    if (currency !== "EUR" && btx.amount > 0) {
      if (await mark(btx.id, { match_status: "review", match_explain: `currency ${currency}` })) out.review += 1;
      continue;
    }
    const decision = matchTransaction(btx, liveInvoices, ibanBindings, ibansByLease, DEFAULT_MATCH_CONFIG);

    if (decision.kind === "auto") {
      const targets = liveInvoices.filter((i) => decision.invoiceIds.includes(i.id));
      if (targets.length === 0) continue;
      const leaseId = targets[0].leaseId;
      // Locale-neutral shorthand: the UI's badge carries the translated tier.
      const explain =
        decision.tier === "rf"
          ? `RF ${targets[0]?.rfReference ?? ""}`
          : decision.tier === "iban_binding"
            ? `IBAN ${targets[0]?.unitLabel ?? ""}`
            : `${decision.tier} · ${Math.round(decision.confidence * 100)} %`;
      const outcome = await recordPaymentFifo(g, orgId, {
        leaseId,
        amountCents: btx.amount,
        receivedOn: btx.bookedAt,
        bankTransactionId: btx.id,
        auto: true,
        periodIds: decision.invoiceIds,
        match: {
          tier: decision.tier,
          confidence: decision.confidence,
          explain: decision.indexationLag ? `${explain} · Δ ${decision.indexationLag.shortfall}` : explain,
        },
        twinDays: DEFAULT_MATCH_CONFIG.manualTwinDays,
      });
      if (isPaymentError(outcome)) {
        // Claimed elsewhere in the meantime (a manual match, another run): that decision stands.
        if (outcome.step !== "claimed") console.error("reconcile post failed:", outcome.step, outcome.code, outcome.message);
        continue;
      }
      out.auto += 1;
      if (!outcome.linked) {
        // Keep the in-memory open ledger truthful for the next transaction:
        // the named periods first, then the tenancy's other open periods,
        // oldest first, exactly as the base allocated.
        const named = allocateFifo(btx.amount, targets);
        const spent = new Map(named.map((a) => [a.invoiceId, a.amount]));
        const left = btx.amount - named.reduce((a, x) => a + x.amount, 0);
        if (left > 0) {
          const rest = liveInvoices.filter((i) => i.leaseId === leaseId).map((i) => ({ ...i, openAmount: i.openAmount - (spent.get(i.id) ?? 0) })).filter((i) => i.openAmount > 0);
          for (const a of allocateFifo(left, rest)) spent.set(a.invoiceId, (spent.get(a.invoiceId) ?? 0) + a.amount);
        }
        liveInvoices = liveInvoices
          .map((i) => ({ ...i, openAmount: i.openAmount - (spent.get(i.id) ?? 0) }))
          .filter((i) => i.openAmount > 0);
      }
    } else if (decision.kind === "review") {
      if (await mark(btx.id, { match_status: "review", match_explain: decision.reason })) out.review += 1;
    } else {
      if (await mark(btx.id, { match_status: "ignored", match_explain: decision.reason })) out.ignored += 1;
    }
  }
  return out;
}

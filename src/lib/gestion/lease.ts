import "server-only";
import type { OrgContext } from "@/lib/gestion/api";
import { validateLeaseDraft } from "@/domain/lease/rules";
import { leaseRF } from "@/domain/banking/rf";
import { addMonths } from "@/domain/dates";
import { getParamValue } from "@/domain/legal/params";
import { leaseIssueText } from "@/lib/i18n/engine";
import type { Dict } from "@/lib/i18n";

/**
 * Creating a tenancy, in one place.
 *
 * Both doorways into a lease — the quick-add dialog and the guided tenant
 * flow on a vacant lot — land here, so the legal engine gets the last word
 * exactly once. A draft that breaks a blocking public-order rule is stored as
 * `draft` and opens no ledger; a clean one goes `active` and its rent periods
 * start on the spot. That is the whole of "Morada knows this rent is due
 * every month": there is no second switch to turn on.
 */

export const DEPOSIT_FORMS = [
  "cash",
  "bank_guarantee",
  "third_party_caution",
  "insurance",
  "state_guarantee",
] as const;
export type DepositForm = (typeof DEPOSIT_FORMS)[number];

export interface LeaseInput {
  unitId: string;
  tenantContactIds: string[];
  type: "residential" | "commercial";
  startDate: string;
  endDate: string | null;
  rentCents: number;
  chargesCents: number;
  /** Day of the month the rent falls due. The schema caps this at 28. */
  paymentDay: number;
  depositMonths: number;
  depositForm: DepositForm;
  furnished: boolean;
}

export interface LeaseResult {
  id: string;
  status: "draft" | "active";
  rfReference: string;
  issues: Array<{ code: string; severity: string; message: string }>;
}

export function normalizeDepositForm(raw: unknown): DepositForm {
  return (DEPOSIT_FORMS as readonly string[]).includes(String(raw)) ? (String(raw) as DepositForm) : "cash";
}

export function normalizePaymentDay(raw: unknown): number {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= 1 && n <= 28 ? n : 1;
}

export async function createLease(
  ctx: OrgContext,
  d: Dict,
  input: LeaseInput,
): Promise<LeaseResult | { error: string }> {
  const { g, org } = ctx;
  const today = new Date().toISOString().slice(0, 10);

  // The guided form collects seven of the eight mandatory mentions; the
  // capital investi declaration is the one it cannot. The engine decides what
  // that means for the lease's status — this function never overrides it.
  const mentions = {
    parties_identity: "ok",
    property_designation: "ok",
    lease_start_date: "ok",
    duration_or_indefinite: "ok",
    rent_amount: "ok",
    charges_regime: "ok",
    deposit_terms: "ok",
    capital_investi_declaration: input.type === "commercial" ? "ok" : "",
  };
  const issues = validateLeaseDraft(
    {
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      monthlyRent: input.rentCents,
      monthlyCharges: input.chargesCents,
      depositMonths: input.depositMonths,
      depositForm: input.depositForm,
      mentions,
      hasCpiEscalationClause: false,
      furnished: input.furnished,
      colocation: input.tenantContactIds.length > 1,
    },
    today,
  );
  const blocking = issues.filter((i) => i.severity === "blocking");
  const status: "draft" | "active" = blocking.length > 0 ? "draft" : "active";
  const issueVars = {
    months: input.depositMonths,
    max: getParamValue(
      input.type === "residential" ? "residential.deposit_max_months" : "commercial.deposit_max_months",
      today,
    ),
    date: "",
  };

  const { data: lease, error: leaseErr } = await g
    .from("leases")
    .insert({
      org_id: org.id,
      unit_id: input.unitId,
      lease_type: input.type,
      status,
      start_date: input.startDate,
      end_date: input.endDate,
      rent_cents: input.rentCents,
      charges_cents: input.chargesCents,
      charges_regime: "advances",
      payment_day: input.paymentDay,
      mentions,
      furnished: input.furnished,
      colocation: input.tenantContactIds.length > 1,
      vat_regime: "exempt",
      details: { depositMonths: input.depositMonths, depositForm: input.depositForm },
    })
    .select("id,seq")
    .single();
  if (leaseErr || !lease) return { error: leaseErr?.code ?? "lease_insert_failed" };

  // The database assigns the lease number; the permanent structured
  // reference is derived from it plus a stable per-workspace prefix.
  const orgSeq = (parseInt(org.id.replace(/-/g, "").slice(0, 6), 16) % 9000) + 1000;
  const rfReference = leaseRF(orgSeq, lease.seq as number);
  const { error: rfErr } = await g
    .from("leases")
    .update({ rf_reference: rfReference })
    .eq("org_id", org.id)
    .eq("id", lease.id);
  if (rfErr) console.error("lease rf update failed:", rfErr.code, rfErr.message);

  const parties = input.tenantContactIds.map((contactId) => ({
    org_id: org.id,
    lease_id: lease.id as string,
    contact_id: contactId,
    role: "tenant",
  }));
  const followUps = [
    g.from("lease_parties").insert(parties),
    g.from("deposits").insert({
      org_id: org.id,
      lease_id: lease.id,
      form: input.depositForm,
      amount_cents: input.rentCents * input.depositMonths,
      status: "pending",
    }),
  ];
  for (const p of followUps) {
    const { error } = await p;
    if (error) console.error("lease follow-up insert failed:", error.code, error.message);
  }

  // An active lease opens its ledger: monthly periods from the start month
  // (capped one year back) through next month. Paid-ness is derived from
  // allocations by the rent_period_status view, never stored.
  if (status === "active") {
    const liveMonthFirst = `${today.slice(0, 7)}-01`;
    const startMonthFirst = `${input.startDate.slice(0, 7)}-01`;
    const floor = addMonths(liveMonthFirst, -11);
    let m = startMonthFirst < floor ? floor : startMonthFirst;
    const end = addMonths(liveMonthFirst, 1);
    const rows: Array<Record<string, unknown>> = [];
    const day = String(input.paymentDay).padStart(2, "0");
    while (m <= end) {
      // total_cents is a generated column: the database sums the parts.
      rows.push({
        org_id: org.id,
        lease_id: lease.id,
        period: m,
        due_date: `${m.slice(0, 7)}-${day}`,
        rent_cents: input.rentCents,
        charges_cents: input.chargesCents,
        other_cents: 0,
        vat_cents: 0,
      });
      m = addMonths(m, 1);
    }
    const { error: rpErr } = await g.from("rent_periods").insert(rows);
    if (rpErr) console.error("rent periods insert failed:", rpErr.code, rpErr.message);
  }

  return {
    id: lease.id as string,
    status,
    rfReference,
    issues: issues.map((i) => ({
      code: i.code,
      severity: i.severity,
      message: leaseIssueText(d, i.code, issueVars, i.message),
    })),
  };
}

/**
 * Re-prices the rent periods a change is allowed to touch.
 *
 * A rent that goes up, or an indexation that is applied, changes what is owed
 * from a date forward. It must never rewrite a month that already carries
 * money: the ledger is the record of what actually happened, and an allocated
 * period is history. So only periods from `fromMonth` onward that have nothing
 * allocated against them are re-priced; everything else is left exactly as the
 * bank and the tenant left it.
 *
 * Returns how many periods were re-priced, so a caller can tell the owner.
 */
export async function repriceOpenPeriods(
  ctx: OrgContext,
  leaseId: string,
  rentCents: number,
  chargesCents: number,
  fromMonth: string,
): Promise<number> {
  const { g, org } = ctx;
  const [{ data: periods, error: pErr }, { data: statuses, error: sErr }] = await Promise.all([
    g.from("rent_periods").select("id,period").eq("org_id", org.id).eq("lease_id", leaseId).gte("period", fromMonth),
    g.from("rent_period_status").select("id,allocated_cents").eq("lease_id", leaseId),
  ]);
  if (pErr || sErr) {
    console.error("reprice lookup failed:", pErr?.message ?? sErr?.message);
    return 0;
  }
  const allocated = new Map<string, number>();
  for (const row of (statuses as Array<{ id: string; allocated_cents: number }> | null) ?? []) {
    allocated.set(row.id, row.allocated_cents ?? 0);
  }
  const open = ((periods as Array<{ id: string; period: string }> | null) ?? []).filter(
    (p) => (allocated.get(p.id) ?? 0) === 0,
  );
  if (open.length === 0) return 0;

  // total_cents is generated: the database re-sums from the parts.
  const { error } = await g
    .from("rent_periods")
    .update({ rent_cents: rentCents, charges_cents: chargesCents })
    .eq("org_id", org.id)
    .in("id", open.map((p) => p.id));
  if (error) {
    console.error("reprice failed:", error.code, error.message);
    return 0;
  }
  return open.length;
}

/** The month a change takes effect from: today's month, or later. */
export function effectiveMonth(from: string | null): string {
  const today = new Date().toISOString().slice(0, 10).slice(0, 7);
  const asked = (from ?? "").slice(0, 7);
  return asked && asked > today ? `${asked}-01` : `${today}-01`;
}

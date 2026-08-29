import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { parseEuroInput } from "@/lib/gestion/euros";
import { validateLeaseDraft } from "@/domain/lease/rules";
import { leaseRF } from "@/domain/banking/rf";
import { addMonths } from "@/domain/dates";
import { getParamValue } from "@/domain/legal/params";
import { getI18n } from "@/lib/i18n";
import { leaseIssueText } from "@/lib/i18n/engine";

const DEPOSIT_FORMS = ["cash", "bank_guarantee", "third_party_caution", "insurance", "state_guarantee"] as const;

/**
 * Creates a lease through the rule engine. A draft that violates a blocking
 * public-order rule is stored as `draft` (no rent periods, no signable
 * paper); a clean one goes `active` and its rent ledger starts on the spot.
 * The engine decides — the endpoint never overrides it.
 */
export async function POST(req: NextRequest) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { locale, d } = await getI18n();
  const today = new Date().toISOString().slice(0, 10);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const unitId = String(body.unitId ?? "");
  const tenantContactId = String(body.tenantContactId ?? "");
  const type = body.type === "commercial" ? "commercial" : "residential";
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.startDate)) ? String(body.startDate) : today;
  const rentCents = parseEuroInput(String(body.rent ?? ""));
  const chargesCents = String(body.charges ?? "").trim() === "" ? 0 : parseEuroInput(String(body.charges)) ?? -1;
  const depositMonths = Math.round(Number(body.depositMonths ?? 2));
  const depositForm = (DEPOSIT_FORMS as readonly string[]).includes(String(body.depositForm))
    ? (String(body.depositForm) as (typeof DEPOSIT_FORMS)[number])
    : "cash";
  if (!unitId || !tenantContactId || !rentCents || chargesCents < 0 || depositMonths < 0 || depositMonths > 12) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const [{ data: unit, error: unitErr }, { data: tenant, error: tenantErr }] = await Promise.all([
    g.from("units").select("id,furnished").eq("org_id", org.id).eq("id", unitId).maybeSingle(),
    g.from("contacts").select("id").eq("org_id", org.id).eq("id", tenantContactId).maybeSingle(),
  ]);
  if (unitErr) return dbError("lease unit lookup", unitErr);
  if (tenantErr) return dbError("lease tenant lookup", tenantErr);
  if (!unit || !tenant) return NextResponse.json({ error: "invalid" }, { status: 400 });

  // The quick form collects seven of the eight mandatory mentions; the
  // capital investi declaration is the one it cannot. The engine decides
  // what that means for the lease's status.
  const mentions = {
    parties_identity: "ok",
    property_designation: "ok",
    lease_start_date: "ok",
    duration_or_indefinite: "ok",
    rent_amount: "ok",
    charges_regime: "ok",
    deposit_terms: "ok",
    capital_investi_declaration: type === "commercial" ? "ok" : "",
  };
  const issues = validateLeaseDraft(
    {
      type,
      startDate,
      endDate: null,
      monthlyRent: rentCents,
      monthlyCharges: chargesCents,
      depositMonths,
      depositForm,
      mentions,
      hasCpiEscalationClause: false,
      furnished: Boolean(unit.furnished),
      colocation: false,
    },
    today,
  );
  const blocking = issues.filter((i) => i.severity === "blocking");
  const status = blocking.length > 0 ? "draft" : "active";
  const issueVars = {
    months: depositMonths,
    max: getParamValue(type === "residential" ? "residential.deposit_max_months" : "commercial.deposit_max_months", today),
    date: "",
  };
  const localizedIssues = issues.map((i) => ({
    code: i.code,
    severity: i.severity,
    message: leaseIssueText(d, i.code, issueVars, i.message),
  }));

  const { data: lease, error: leaseErr } = await g
    .from("leases")
    .insert({
      org_id: org.id,
      unit_id: unitId,
      lease_type: type,
      status,
      start_date: startDate,
      rent_cents: rentCents,
      charges_cents: chargesCents,
      charges_regime: "advances",
      payment_day: 1,
      mentions,
      furnished: Boolean(unit.furnished),
      colocation: false,
      vat_regime: "exempt",
      details: { depositMonths, depositForm },
    })
    .select("id,seq")
    .single();
  if (leaseErr || !lease) return dbError("lease insert", leaseErr);

  // The database assigns the lease number; the permanent RF reference is
  // derived from it plus a stable per-workspace prefix.
  const orgSeq = (parseInt(org.id.replace(/-/g, "").slice(0, 6), 16) % 9000) + 1000;
  const { error: rfErr } = await g
    .from("leases")
    .update({ rf_reference: leaseRF(orgSeq, lease.seq as number) })
    .eq("org_id", org.id)
    .eq("id", lease.id);
  if (rfErr) console.error("lease rf update failed:", rfErr.code, rfErr.message);

  const followUps = [
    g.from("lease_parties").insert({ org_id: org.id, lease_id: lease.id, contact_id: tenantContactId, role: "tenant" }),
    g.from("deposits").insert({
      org_id: org.id,
      lease_id: lease.id,
      form: depositForm,
      amount_cents: rentCents * depositMonths,
      status: "pending",
    }),
  ];
  for (const p of followUps) {
    const { error } = await p;
    if (error) console.error("lease follow-up insert failed:", error.code, error.message);
  }

  // An active lease opens its ledger: monthly periods from the start month
  // (capped one year back) through next month. Paid-ness will be derived
  // from allocations by the rent_period_status view, never stored.
  if (status === "active") {
    const liveMonthFirst = `${today.slice(0, 7)}-01`;
    const startMonthFirst = `${startDate.slice(0, 7)}-01`;
    const floor = addMonths(liveMonthFirst, -11);
    let m = startMonthFirst < floor ? floor : startMonthFirst;
    const end = addMonths(liveMonthFirst, 1);
    const rows: Array<Record<string, unknown>> = [];
    while (m <= end) {
      // total_cents is a generated column: the database sums the parts.
      rows.push({
        org_id: org.id,
        lease_id: lease.id,
        period: m,
        due_date: m,
        rent_cents: rentCents,
        charges_cents: chargesCents,
        other_cents: 0,
        vat_cents: 0,
      });
      m = addMonths(m, 1);
    }
    const { error: rpErr } = await g.from("rent_periods").insert(rows);
    if (rpErr) console.error("rent periods insert failed:", rpErr.code, rpErr.message);
  }

  return NextResponse.json({ id: lease.id, status, issues: localizedIssues, locale });
}

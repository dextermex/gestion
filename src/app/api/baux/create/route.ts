import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { parseEuroInput } from "@/lib/gestion/euros";
import { LIVE_STATUSES, createLease, normalizeDepositForm, normalizePaymentDay } from "@/lib/gestion/lease";
import { getI18n } from "@/lib/i18n";
import { todayISO } from "@/lib/clock";

/**
 * The quick-add lease: an existing contact on an existing lot.
 *
 * The guided flow on a vacant lot (/api/locations/create) creates the tenant
 * first and then lands in the same place — both share `createLease`, so the
 * rule engine, the deposit and the rent ledger behave identically whichever
 * door the owner came through.
 */
/** "start" to follow the rent from the tenancy's first month, a month (YYYY-MM) from there; anything else, from this month. */
function trackFromOf(raw: unknown): string | null {
  if (raw === "start") return "start";
  return typeof raw === "string" && /^\d{4}-\d{2}$/.test(raw) ? raw : null;
}

export async function POST(req: NextRequest) {
  const ctx = await withOrg("write");
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { locale, d } = await getI18n();
  const today = todayISO();

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const unitId = String(body.unitId ?? "");
  const tenantContactId = String(body.tenantContactId ?? "");
  const type = body.type === "commercial" ? "commercial" : "residential";
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.startDate)) ? String(body.startDate) : today;
  const rentCents = parseEuroInput(String(body.rent ?? ""));
  const chargesCents = String(body.charges ?? "").trim() === "" ? 0 : parseEuroInput(String(body.charges)) ?? -1;
  const depositMonths = Math.round(Number(body.depositMonths ?? 2));
  const depositForm = normalizeDepositForm(body.depositForm);
  if (!unitId || !tenantContactId || !rentCents || chargesCents < 0 || depositMonths < 0 || depositMonths > 12) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  // The lot and the person exist in this workspace and are still on its screens:
  // an archived lot or contact is not let to, whatever a stale form sends.
  const [{ data: unit, error: unitErr }, { data: tenant, error: tenantErr }] = await Promise.all([
    g.from("units").select("id,furnished,archived_at").eq("org_id", org.id).eq("id", unitId).maybeSingle(),
    g.from("contacts").select("id,archived_at").eq("org_id", org.id).eq("id", tenantContactId).maybeSingle(),
  ]);
  if (unitErr) return dbError("lease unit lookup", unitErr);
  if (tenantErr) return dbError("lease tenant lookup", tenantErr);
  if (!unit || !tenant || unit.archived_at || tenant.archived_at) return NextResponse.json({ error: "invalid" }, { status: 400 });
  // A lot already let takes no second tenancy: said as such, before anything is written.
  const { data: live, error: liveErr } = await g.from("leases").select("id").eq("org_id", org.id).eq("unit_id", unitId).in("status", [...LIVE_STATUSES]).limit(1);
  if (liveErr) return dbError("lease occupancy lookup", liveErr);
  if ((live ?? []).length > 0) return NextResponse.json({ error: "already_let" }, { status: 409 });

  const lease = await createLease(ctx, d, {
    unitId,
    tenantContactIds: [tenantContactId],
    colocation: false,
    type,
    startDate,
    endDate: null,
    rentCents,
    chargesCents,
    paymentDay: normalizePaymentDay(body.paymentDay ?? 1),
    depositMonths,
    depositForm,
    furnished: unit.furnished === true,
  }, trackFromOf(body.trackFrom));
  if ("error" in lease) {
    // Two requests for the same lot: the base lets one through and names the other.
    if (lease.error === "already_let") return NextResponse.json({ error: "already_let" }, { status: 409 });
    return dbError("lease insert", { code: lease.error });
  }

  return NextResponse.json({ id: lease.id, status: lease.status, issues: lease.issues, pending: lease.pending, locale });
}

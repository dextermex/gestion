import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { parseEuroInput } from "@/lib/gestion/euros";
import { createLease, normalizeDepositForm, normalizePaymentDay } from "@/lib/gestion/lease";
import { getI18n } from "@/lib/i18n";

/**
 * The quick-add lease: an existing contact on an existing lot.
 *
 * The guided flow on a vacant lot (/api/locations/create) creates the tenant
 * first and then lands in the same place — both share `createLease`, so the
 * rule engine, the deposit and the rent ledger behave identically whichever
 * door the owner came through.
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
  const depositForm = normalizeDepositForm(body.depositForm);
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

  const lease = await createLease(ctx, d, {
    unitId,
    tenantContactIds: [tenantContactId],
    type,
    startDate,
    endDate: null,
    rentCents,
    chargesCents,
    paymentDay: normalizePaymentDay(body.paymentDay ?? 1),
    depositMonths,
    depositForm,
    furnished: unit.furnished === true,
  });
  if ("error" in lease) return dbError("lease insert", { code: lease.error });

  return NextResponse.json({ id: lease.id, status: lease.status, issues: lease.issues, locale });
}

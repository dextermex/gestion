import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { parseEuroInput } from "@/lib/gestion/euros";
import { createLease, normalizeDepositForm, normalizePaymentDay } from "@/lib/gestion/lease";
import { getI18n } from "@/lib/i18n";

/**
 * The guided tenancy: one call that turns a vacant lot into a running rental.
 *
 * It creates the tenant, hands the lease to the legal engine, records the
 * guarantee, and remembers the account the rent will arrive from. The lot is
 * known from where the owner started, so it is never asked for again, and the
 * property is read from the lot rather than trusted from the request.
 */

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** IBAN as stored elsewhere in the product: upper case, no spaces. */
function normalizeIban(raw: string): string | null {
  const iban = raw.replace(/[\s]/g, "").toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban) ? iban : null;
}

export async function POST(req: NextRequest) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { d, locale } = await getI18n();
  const today = new Date().toISOString().slice(0, 10);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const unitId = str(body.unitId, 64);
  const firstName = str(body.firstName, 80);
  const lastName = str(body.lastName, 80);
  const rentCents = parseEuroInput(str(body.rent, 20));
  const chargesRaw = str(body.charges, 20);
  const chargesCents = chargesRaw === "" ? 0 : parseEuroInput(chargesRaw) ?? -1;
  const startDate = ISO.test(str(body.startDate, 10)) ? str(body.startDate, 10) : today;
  const endDate = ISO.test(str(body.endDate, 10)) ? str(body.endDate, 10) : null;
  const type = body.type === "commercial" ? "commercial" : "residential";
  const paymentDay = normalizePaymentDay(body.paymentDay);
  const depositForm = normalizeDepositForm(body.depositForm);
  const depositMonths = Math.round(Number(body.depositMonths ?? 0));

  if (!unitId || (!firstName && !lastName) || !rentCents || chargesCents < 0) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  if (!Number.isFinite(depositMonths) || depositMonths < 0 || depositMonths > 12) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  // The lot decides the property and whether the home is furnished; the
  // request is not believed about either.
  const { data: unit, error: unitErr } = await g
    .from("units")
    .select("id,furnished,property_id")
    .eq("org_id", org.id)
    .eq("id", unitId)
    .maybeSingle();
  if (unitErr) return dbError("rental unit lookup", unitErr);
  if (!unit) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // A lot already under a live lease cannot take a second one.
  const { data: existing, error: busyErr } = await g
    .from("leases")
    .select("id")
    .eq("org_id", org.id)
    .eq("unit_id", unitId)
    .in("status", ["active", "notice"])
    .limit(1);
  if (busyErr) return dbError("rental occupancy lookup", busyErr);
  if ((existing ?? []).length > 0) return NextResponse.json({ error: "already_let" }, { status: 409 });

  // display_name is a generated column: the parts go in, the label comes out.
  const { data: contact, error: contactErr } = await g
    .from("contacts")
    .insert({
      org_id: org.id,
      kind: "natural",
      first_name: firstName || null,
      last_name: lastName || null,
      email: str(body.email, 160) || null,
      phone: str(body.phone, 40) || null,
      language: ["fr", "en", "de", "lu"].includes(str(body.language, 2)) ? str(body.language, 2) : locale,
    })
    .select("id")
    .single();
  if (contactErr || !contact) return dbError("tenant contact insert", contactErr);

  const { error: roleErr } = await g
    .from("contact_roles")
    .insert({ org_id: org.id, contact_id: contact.id, role: "tenant" });
  if (roleErr) console.error("tenant role insert failed:", roleErr.code, roleErr.message);

  const lease = await createLease(ctx, d, {
    unitId,
    tenantContactIds: [contact.id as string],
    type,
    startDate,
    endDate,
    rentCents,
    chargesCents,
    paymentDay,
    depositMonths,
    depositForm,
    furnished: unit.furnished === true,
  });
  if ("error" in lease) return dbError("lease insert", { code: lease.error });

  // The account the rent is expected from. It makes the matcher confident,
  // it never makes it certain: a transfer from an unknown account still
  // lands in review rather than being refused.
  const iban = normalizeIban(str(body.payerIban, 40));
  if (iban) {
    const { error: bindErr } = await g
      .from("iban_bindings")
      .insert({ org_id: org.id, payer_iban: iban, lease_id: lease.id });
    if (bindErr) console.error("payer binding insert failed:", bindErr.code, bindErr.message);
    const holder = str(body.payerName, 120);
    const { error: ibanErr } = await g
      .from("contacts")
      .update({ iban, bank_holder_name: holder || null })
      .eq("org_id", org.id)
      .eq("id", contact.id);
    if (ibanErr) console.error("tenant iban update failed:", ibanErr.code, ibanErr.message);
  }

  return NextResponse.json({
    leaseId: lease.id,
    contactId: contact.id,
    propertyId: unit.property_id,
    status: lease.status,
    issues: lease.issues,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { isCivility, isLegalForm } from "@/lib/documents/contract-parties";

/** A contact's identity and reach. `display_name` is a generated column, so
 *  the parts go in and the label comes back out on its own.
 *
 *  The identity a lease contract names (a person's civility, birth and
 *  nationality, or a company's form, register number and representative)
 *  rides on the same route. Those columns arrive with migration 0028: until
 *  the base carries them, a save that touches them answers `schema_outdated`
 *  and changes nothing, so the editor can say so in words. */
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
/** One printed line of a contract: no control characters, no line breaks. */
const line = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const has = (b: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(b, k);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** The columns migration 0028 adds: their absence is the base being behind, not the request being wrong. */
const IDENTITY_COLUMNS = /civility|birth_date|birth_place|legal_form|representative_name|representative_role/;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg("write");
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  if (has(body, "firstName")) patch.first_name = str(body.firstName, 80) || null;
  if (has(body, "lastName")) patch.last_name = str(body.lastName, 80) || null;
  if (has(body, "legalName")) patch.legal_name = str(body.legalName, 160) || null;
  if (has(body, "email")) patch.email = str(body.email, 160).toLowerCase() || null;
  if (has(body, "phone")) patch.phone = str(body.phone, 40) || null;
  if (has(body, "language") && ["fr", "en", "de", "lu"].includes(str(body.language, 2))) {
    patch.language = str(body.language, 2);
  }
  if (has(body, "iban")) patch.iban = str(body.iban, 40).replace(/\s/g, "").toUpperCase() || null;
  if (has(body, "bankHolderName")) patch.bank_holder_name = str(body.bankHolderName, 120) || null;
  if (has(body, "notes")) patch.notes = str(body.notes, 2000) || null;

  // The identity a contract names. A value outside its list is refused, never stored half-read.
  if (has(body, "kind")) {
    if (!["natural", "legal"].includes(String(body.kind))) return NextResponse.json({ error: "invalid", field: "kind" }, { status: 400 });
    patch.kind = body.kind;
  }
  if (has(body, "civility")) {
    const v = line(body.civility, 8);
    if (v && !isCivility(v)) return NextResponse.json({ error: "invalid", field: "civility" }, { status: 400 });
    patch.civility = v || null;
  }
  if (has(body, "birthDate")) {
    const v = line(body.birthDate, 10);
    if (v && (!ISO.test(v) || v <= "1900-01-01" || v > new Date().toISOString().slice(0, 10))) return NextResponse.json({ error: "invalid", field: "birthDate" }, { status: 400 });
    patch.birth_date = v || null;
  }
  if (has(body, "birthPlace")) patch.birth_place = line(body.birthPlace, 120) || null;
  if (has(body, "nationality")) patch.nationality = line(body.nationality, 80) || null;
  if (has(body, "legalForm")) {
    const v = line(body.legalForm, 20);
    if (v && !isLegalForm(v)) return NextResponse.json({ error: "invalid", field: "legalForm" }, { status: 400 });
    patch.legal_form = v || null;
  }
  if (has(body, "rcsNumber")) patch.rcs_number = line(body.rcsNumber, 40) || null;
  if (has(body, "representativeName")) patch.representative_name = line(body.representativeName, 160) || null;
  if (has(body, "representativeRole")) patch.representative_role = line(body.representativeRole, 80) || null;
  // Where the person lives, or where the company has its seat: one object, written whole.
  if (["addressStreet", "addressNumber", "addressPostal", "addressCity", "addressCountry"].some((k) => has(body, k))) {
    const country = line(body.addressCountry, 2).toUpperCase();
    if (country && !/^[A-Z]{2}$/.test(country)) return NextResponse.json({ error: "invalid", field: "addressCountry" }, { status: 400 });
    patch.address = {
      street: line(body.addressStreet, 160),
      number: line(body.addressNumber, 20),
      postal_code: line(body.addressPostal, 12),
      city: line(body.addressCity, 80),
      country: country || "LU",
    };
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  // A natural person needs at least one name part to stay identifiable.
  if (patch.first_name === null && patch.last_name === null && !has(body, "legalName")) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();
  const { data, error } = await g.from("contacts").update(patch).eq("org_id", org.id).eq("id", id).select("id");
  // One live contact per e-mail in a workspace (contacts_email_active_key):
  // the editor is told which field, instead of a generic failure.
  if (error?.code === "23505") return NextResponse.json({ error: "email_taken" }, { status: 409 });
  if (error && (error.code === "PGRST204" || error.code === "42703") && IDENTITY_COLUMNS.test(error.message ?? "")) {
    return NextResponse.json({ error: "schema_outdated" }, { status: 503 });
  }
  if (error) return dbError("contact update", error);
  if (!data?.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

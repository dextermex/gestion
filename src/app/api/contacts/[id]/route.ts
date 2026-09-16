import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";

/** A contact's identity and reach. `display_name` is a generated column, so
 *  the parts go in and the label comes back out on its own. */
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const has = (b: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(b, k);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  if (has(body, "firstName")) patch.first_name = str(body.firstName, 80) || null;
  if (has(body, "lastName")) patch.last_name = str(body.lastName, 80) || null;
  if (has(body, "legalName")) patch.legal_name = str(body.legalName, 160) || null;
  if (has(body, "email")) patch.email = str(body.email, 160) || null;
  if (has(body, "phone")) patch.phone = str(body.phone, 40) || null;
  if (has(body, "language") && ["fr", "en", "de", "lu"].includes(str(body.language, 2))) {
    patch.language = str(body.language, 2);
  }
  if (has(body, "iban")) patch.iban = str(body.iban, 40).replace(/\s/g, "").toUpperCase() || null;
  if (has(body, "bankHolderName")) patch.bank_holder_name = str(body.bankHolderName, 120) || null;
  if (has(body, "notes")) patch.notes = str(body.notes, 2000) || null;

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  // A natural person needs at least one name part to stay identifiable.
  if (patch.first_name === null && patch.last_name === null && !has(body, "legalName")) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();
  const { data, error } = await g.from("contacts").update(patch).eq("org_id", org.id).eq("id", id).select("id");
  if (error) return dbError("contact update", error);
  if (!data?.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

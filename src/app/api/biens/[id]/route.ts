import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";

/**
 * Editing a property, and retiring one.
 *
 * The focused editors behind "Modifier" each send the handful of fields they
 * own, so this route builds its update from whatever arrived and leaves the
 * rest of the row alone. A property is never deleted: `archived_at` takes it
 * out of every screen while its leases, payments and documents stay exactly
 * where they are, because a portfolio's history has to outlive the sale of
 * the thing it happened in.
 */

const ENERGY = ["A+", "A", "B", "C", "D", "E", "F", "G", "H", "I"] as const;

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown, max: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
};
const has = (b: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(b, k);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Archiving is its own verb, not a field: it is the one change that takes
  // the property off every screen, so it never rides along with an edit.
  if (body.action === "archive" || body.action === "restore") {
    const { error } = await g
      .from("properties")
      .update({ archived_at: body.action === "archive" ? new Date().toISOString() : null })
      .eq("org_id", org.id)
      .eq("id", id)
      .select("id");
    if (error) return dbError("property archive", error);
    return NextResponse.json({ ok: true, archived: body.action === "archive" });
  }

  const patch: Record<string, unknown> = {};
  if (has(body, "name")) {
    const name = str(body.name, 120);
    if (!name) return NextResponse.json({ error: "invalid" }, { status: 400 });
    patch.name = name;
  }
  // The address is one jsonb column, so it is replaced as a whole or not at all.
  if (has(body, "street") || has(body, "city")) {
    const street = str(body.street, 160);
    const city = str(body.city, 80);
    if (!street || !city) return NextResponse.json({ error: "invalid" }, { status: 400 });
    patch.address = {
      street,
      number: str(body.number, 10),
      postal_code: str(body.postal, 10),
      city,
      country: ["LU", "FR", "BE", "DE"].includes(String(body.country)) ? String(body.country) : "LU",
    };
    patch.commune = city;
  }
  if (has(body, "constructionYear")) {
    const y = num(body.constructionYear, 2200);
    patch.construction_year = y === null ? null : Math.round(y);
  }
  if (has(body, "energyClass")) {
    patch.energy_class = (ENERGY as readonly string[]).includes(String(body.energyClass))
      ? String(body.energyClass)
      : null;
  }
  if (has(body, "cpeIssuedOn")) {
    patch.cpe_issued_on = /^\d{4}-\d{2}-\d{2}$/.test(str(body.cpeIssuedOn, 10)) ? str(body.cpeIssuedOn, 10) : null;
  }
  if (has(body, "smokeDetectorsConfirmed")) patch.smoke_detectors_confirmed = body.smokeDetectorsConfirmed === true;
  if (has(body, "isCopropriete")) patch.is_copropriete = body.isCopropriete === true;
  if (has(body, "syndicName")) patch.syndic_name = str(body.syndicName, 120) || null;
  if (has(body, "syndicMandateStart")) {
    patch.syndic_mandate_start = /^\d{4}-\d{2}-\d{2}$/.test(str(body.syndicMandateStart, 10))
      ? str(body.syndicMandateStart, 10)
      : null;
  }
  if (has(body, "cadastralCommune")) patch.cadastral_commune = str(body.cadastralCommune, 80) || null;
  if (has(body, "cadastralSection")) patch.cadastral_section = str(body.cadastralSection, 20) || null;
  if (has(body, "cadastralNumber")) patch.cadastral_number = str(body.cadastralNumber, 40) || null;
  if (has(body, "photoUrl") && body.photoUrl === null) patch.photo_url = null;

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  patch.updated_at = new Date().toISOString();

  // `.select()` after the write: under RLS a refused update returns zero rows
  // rather than an error, and that must never read as success.
  const { data, error } = await g
    .from("properties")
    .update(patch)
    .eq("org_id", org.id)
    .eq("id", id)
    .select("id");
  if (error) return dbError("property update", error);
  if (!data || data.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";

/**
 * Creates a property and its lots in one call, under the caller's own JWT:
 * RLS decides, no service key.
 *
 * The hierarchy is the product's spine — a building and an apartment are not
 * the same object. A house, an apartment or a commercial unit IS one lettable
 * lot, so the endpoint creates it implicitly; a building is a container, and
 * its lots come from the wizard. Either way a lease can only ever attach to a
 * unit, never to a property.
 */

/** Wizard type → the schema's `type` value, and what lots to open with. */
const TYPES = {
  apartment: { type: "apartment", copro: true, unitKind: "dwelling" },
  house: { type: "house", copro: false, unitKind: "dwelling" },
  building: { type: "apartment_building", copro: false, unitKind: null },
  commercial: { type: "commercial", copro: false, unitKind: "commercial" },
  other: { type: "other", copro: false, unitKind: "dwelling" },
} as const;

const UNIT_KINDS = ["dwelling", "commercial", "office", "parking", "cellar", "other"] as const;
const ENERGY = ["A+", "A", "B", "C", "D", "E", "F", "G", "H", "I"] as const;

type UnitInput = {
  label?: string;
  kind?: string;
  floor?: string;
  areaSqm?: number | string;
  rooms?: number | string;
  bedrooms?: number | string;
  furnished?: boolean;
};

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
/** A measurement, or null when the owner left it for later. */
const num = (v: unknown, max: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
};

export async function POST(req: NextRequest) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = String(body.type ?? "") as keyof typeof TYPES;
  const shape = TYPES[kind];
  const name = str(body.name, 120);
  const street = str(body.street, 160);
  const number = str(body.number, 10);
  const postal = str(body.postal, 10);
  const city = str(body.city, 80);
  const country = ["LU", "FR", "BE", "DE"].includes(String(body.country)) ? String(body.country) : "LU";
  if (!shape || !name || !street || !city) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const year = num(body.constructionYear, 2200);
  const energy = (ENERGY as readonly string[]).includes(String(body.energyClass))
    ? String(body.energyClass)
    : null;

  const { data: property, error: propErr } = await g
    .from("properties")
    .insert({
      org_id: org.id,
      name,
      type: shape.type,
      address: { street, number, postal_code: postal, city, country },
      commune: city,
      is_copropriete: typeof body.isCopropriete === "boolean" ? body.isCopropriete : shape.copro,
      construction_year: year === null ? null : Math.round(year),
      energy_class: energy,
      cadastral_commune: str(body.cadastralCommune, 80) || null,
      cadastral_section: str(body.cadastralSection, 20) || null,
      cadastral_number: str(body.cadastralNumber, 40) || null,
      syndic_name: str(body.syndicName, 120) || null,
    })
    .select("id")
    .single();
  if (propErr || !property) return dbError("property insert", propErr);

  // The lots. A single-home property gets exactly one, named after itself so
  // the sheet reads naturally before anyone renames it; a building gets what
  // the wizard collected, and may legitimately get none yet.
  const supplied = Array.isArray(body.units) ? (body.units as UnitInput[]) : [];
  const rows = shape.unitKind
    ? [
        {
          org_id: org.id,
          property_id: property.id,
          label: str(body.unitLabel, 60) || name,
          kind: shape.unitKind,
          floor: str(body.floor, 20) || null,
          area_sqm: num(body.areaSqm, 100000),
          rooms: num(body.rooms, 100),
          bedrooms: num(body.bedrooms, 100) === null ? null : Math.round(num(body.bedrooms, 100)!),
          furnished: body.furnished === true,
        },
      ]
    : supplied
        .filter((u) => str(u.label, 60) !== "")
        .slice(0, 200)
        .map((u) => ({
          org_id: org.id,
          property_id: property.id,
          label: str(u.label, 60),
          kind: (UNIT_KINDS as readonly string[]).includes(String(u.kind)) ? String(u.kind) : "dwelling",
          floor: str(u.floor, 20) || null,
          area_sqm: num(u.areaSqm, 100000),
          rooms: num(u.rooms, 100),
          bedrooms: num(u.bedrooms, 100) === null ? null : Math.round(num(u.bedrooms, 100)!),
          furnished: u.furnished === true,
        }));

  let units: Array<{ id: string; label: string }> = [];
  if (rows.length > 0) {
    const { data, error: unitErr } = await g.from("units").insert(rows).select("id,label");
    // The property exists; a failed lot insert must not lose it. The sheet
    // will simply show no lots, and the owner can add them there.
    if (unitErr) console.error("units insert failed:", unitErr.code, unitErr.message);
    units = (data as Array<{ id: string; label: string }> | null) ?? [];
  }

  return NextResponse.json({ id: property.id, units });
}

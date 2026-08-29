import { NextRequest, NextResponse } from "next/server";
import { authedClient, getSession } from "@/lib/supabase/server";
import { getIdentity } from "@/lib/workspace";

/**
 * Creates a property (and its implied unit for a house or a single lot) in
 * gestion.*, under the caller's own JWT: RLS decides, no service key. The
 * wizard is the only client.
 */

const TYPE_MAP = {
  building: "apartment_building",
  units: "apartment",
  house: "house",
} as const;

interface Body {
  type?: string;
  name?: string;
  street?: string;
  number?: string;
  postal?: string;
  city?: string;
  country?: string;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const identity = await getIdentity();
  const org = identity?.active;
  if (!org) return NextResponse.json({ error: "no_workspace" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const kind = (body.type ?? "") as keyof typeof TYPE_MAP;
  const name = (body.name ?? "").trim().slice(0, 120);
  const street = (body.street ?? "").trim().slice(0, 160);
  const number = (body.number ?? "").trim().slice(0, 10);
  const postal = (body.postal ?? "").trim().slice(0, 10);
  const city = (body.city ?? "").trim().slice(0, 80);
  const country = ["LU", "FR", "BE", "DE"].includes(body.country ?? "") ? body.country! : "LU";
  if (!TYPE_MAP[kind] || !name || !street || !city) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const g = authedClient(session.accessToken).schema("gestion");
  const { data: property, error: propErr } = await g
    .from("properties")
    .insert({
      org_id: org.id,
      name,
      type: TYPE_MAP[kind],
      address: { street, number, postal_code: postal, city, country },
      commune: city,
      is_copropriete: kind === "units",
    })
    .select("id")
    .single();

  if (propErr || !property) {
    const code = (propErr as { code?: string } | null)?.code;
    if (code === "PGRST106") return NextResponse.json({ error: "schema_unexposed" }, { status: 503 });
    if (code === "42501") return NextResponse.json({ error: "forbidden" }, { status: 403 });
    console.error("property insert failed:", propErr);
    return NextResponse.json({ error: "storage_failed" }, { status: 502 });
  }

  // A house or a single lot IS a dwelling; a whole building starts empty and
  // gets its lots from the property sheet.
  if (kind !== "building") {
    const { error: unitErr } = await g.from("units").insert({
      org_id: org.id,
      property_id: property.id,
      label: kind === "house" ? "Maison" : "Lot 1",
      kind: "dwelling",
    });
    if (unitErr) console.error("implied unit insert failed:", unitErr);
  }

  return NextResponse.json({ id: property.id });
}

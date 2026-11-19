import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError, isUuid, isoDay, refuseWithout } from "@/lib/gestion/api";
import { parseEuroInput } from "@/lib/gestion/euros";

/** One insurance policy: the building's, or the tenancy's. */
const KINDS = ["building", "pno", "liability", "rent_guarantee", "pi", "other"] as const;
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const has = (b: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(b, k);
const PERMISSION = "gestion.properties.edit";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg("write");
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const refused = await refuseWithout(ctx, PERMISSION);
  if (refused) return refused;
  const raw = (await req.json().catch(() => null)) as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const body = raw as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  if (has(body, "kind")) {
    if (!(KINDS as readonly string[]).includes(String(body.kind))) return NextResponse.json({ error: "invalid" }, { status: 400 });
    patch.kind = String(body.kind);
  }
  if (has(body, "provider")) {
    const provider = str(body.provider, 120);
    if (!provider) return NextResponse.json({ error: "invalid" }, { status: 400 });
    patch.provider = provider;
  }
  if (has(body, "policyNumber")) patch.policy_number = str(body.policyNumber, 80);
  if (has(body, "premium")) {
    // An empty premium is "none"; one that does not read as an amount is refused, never stored as zero.
    const premium = str(body.premium, 20);
    const cents = premium === "" ? 0 : parseEuroInput(premium);
    if (cents === null) return NextResponse.json({ error: "invalid" }, { status: 400 });
    patch.premium_cents = cents;
  }
  // A date is a real day or is cleared; anything else is refused.
  for (const [key, column] of [["startsOn", "starts_on"], ["expiresOn", "expires_on"]] as const) {
    if (!has(body, key)) continue;
    const given = body[key];
    const value = given === null || given === "" ? null : isoDay(given);
    if (value === null && given !== null && given !== "") return NextResponse.json({ error: "invalid" }, { status: 400 });
    patch[column] = value;
  }
  if (typeof patch.starts_on === "string" && typeof patch.expires_on === "string" && patch.expires_on < patch.starts_on) return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (has(body, "notes")) patch.notes = str(body.notes, 2000);

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  const { data, error } = await g.from("insurance_policies").update(patch).eq("org_id", org.id).eq("id", id).select("id");
  if (error) return dbError("insurance update", error);
  if (!data?.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg("write");
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const refused = await refuseWithout(ctx, PERMISSION);
  if (refused) return refused;
  // "Deleted" is said only of a row that was: none matched is not found.
  const { data, error } = await g.from("insurance_policies").delete().eq("org_id", org.id).eq("id", id).select("id");
  if (error) return dbError("insurance delete", error);
  if (!data?.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

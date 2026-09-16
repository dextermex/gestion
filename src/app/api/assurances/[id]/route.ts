import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { parseEuroInput } from "@/lib/gestion/euros";

/** One insurance policy: the building's, or the tenancy's. */
const KINDS = ["building", "pno", "liability", "rent_guarantee", "pi", "other"] as const;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const has = (b: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(b, k);
const day = (v: unknown) => (ISO.test(str(v, 10)) ? str(v, 10) : null);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  if (has(body, "kind") && (KINDS as readonly string[]).includes(String(body.kind))) patch.kind = String(body.kind);
  if (has(body, "provider")) {
    const provider = str(body.provider, 120);
    if (!provider) return NextResponse.json({ error: "invalid" }, { status: 400 });
    patch.provider = provider;
  }
  if (has(body, "policyNumber")) patch.policy_number = str(body.policyNumber, 80);
  if (has(body, "premium")) {
    const raw = str(body.premium, 20);
    patch.premium_cents = raw === "" ? 0 : parseEuroInput(raw) ?? 0;
  }
  if (has(body, "startsOn")) patch.starts_on = day(body.startsOn);
  if (has(body, "expiresOn")) patch.expires_on = day(body.expiresOn);
  if (has(body, "notes")) patch.notes = str(body.notes, 2000);

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  const { data, error } = await g.from("insurance_policies").update(patch).eq("org_id", org.id).eq("id", id).select("id");
  if (error) return dbError("insurance update", error);
  if (!data?.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id } = await params;
  const { error } = await g.from("insurance_policies").delete().eq("org_id", org.id).eq("id", id);
  if (error) return dbError("insurance delete", error);
  return NextResponse.json({ ok: true });
}

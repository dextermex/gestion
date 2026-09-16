import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { parseEuroInput } from "@/lib/gestion/euros";

/** The rental guarantee attached to a lease: its form, its amount, where it
 *  stands, and the dates the settlement engine reads. */
const FORMS = ["cash", "bank_guarantee", "third_party_caution", "insurance", "state_guarantee"] as const;
const STATES = ["pending", "held", "release_pending", "partially_released", "released", "forfeited", "disputed"] as const;
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
  if (has(body, "form") && (FORMS as readonly string[]).includes(String(body.form))) patch.form = String(body.form);
  if (has(body, "status") && (STATES as readonly string[]).includes(String(body.status))) patch.status = String(body.status);
  if (has(body, "amount")) {
    const cents = parseEuroInput(str(body.amount, 20));
    if (cents === null) return NextResponse.json({ error: "invalid" }, { status: 400 });
    patch.amount_cents = cents;
  }
  if (has(body, "receivedOn")) patch.received_on = day(body.receivedOn);
  if (has(body, "providerRef")) patch.provider_ref = str(body.providerRef, 120) || null;
  if (has(body, "keyHandoverOn")) patch.key_handover_on = day(body.keyHandoverOn);
  if (has(body, "decompteIssuedOn")) patch.decompte_issued_on = day(body.decompteIssuedOn);

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  const { data, error } = await g.from("deposits").update(patch).eq("org_id", org.id).eq("id", id).select("id");
  if (error) return dbError("deposit update", error);
  if (!data?.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

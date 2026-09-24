import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { parseEuroInput } from "@/lib/gestion/euros";
import { depositTransitionAllowed } from "@/lib/gestion/deposits";
import type { DepositStatus } from "@/lib/types";

/**
 * The rental guarantee attached to a lease: its form, its amount, where it
 * stands, and the dates the settlement engine reads.
 *
 * Where it stands only moves along the transitions `deposits.ts` allows: a
 * guarantee is received (pending to held), its restitution opens once the
 * keys are back, a dispute is declared and closed. What a release does to
 * the status is the liberation route's business, never a status typed here.
 */
const FORMS = ["cash", "bank_guarantee", "third_party_caution", "insurance", "state_guarantee"] as const;
const STATES = ["pending", "held", "release_pending", "partially_released", "released", "forfeited", "disputed"] as const;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const has = (b: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(b, k);
const day = (v: unknown) => (ISO.test(str(v, 10)) && !Number.isNaN(Date.parse(str(v, 10))) ? str(v, 10) : null);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const today = new Date().toISOString().slice(0, 10);

  const { data: current, error: readErr } = await g
    .from("deposits")
    .select("id,status,key_handover_on,received_on")
    .eq("org_id", org.id)
    .eq("id", id)
    .maybeSingle();
  if (readErr) return dbError("deposit lookup", readErr);
  if (!current) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const from = String(current.status) as DepositStatus;

  const patch: Record<string, unknown> = {};
  // The guarantee's terms may change while it is only pending or held;
  // once a restitution has begun, its amount and form are facts.
  const terms = from === "pending" || from === "held";
  if (has(body, "form") && (FORMS as readonly string[]).includes(String(body.form))) {
    if (!terms) return NextResponse.json({ error: "refused" }, { status: 409 });
    patch.form = String(body.form);
  }
  if (has(body, "amount")) {
    if (!terms) return NextResponse.json({ error: "refused" }, { status: 409 });
    const cents = parseEuroInput(str(body.amount, 20));
    if (cents === null) return NextResponse.json({ error: "invalid" }, { status: 400 });
    patch.amount_cents = cents;
  }
  if (has(body, "providerRef")) patch.provider_ref = str(body.providerRef, 120) || null;
  for (const [key, column] of [
    ["receivedOn", "received_on"],
    ["keyHandoverOn", "key_handover_on"],
    ["decompteIssuedOn", "decompte_issued_on"],
    ["miseEnDemeureArOn", "mise_en_demeure_ar_on"],
  ] as const) {
    if (!has(body, key)) continue;
    const d = day(body[key]);
    if (!d || d > today) return NextResponse.json({ error: "invalid" }, { status: 400 });
    patch[column] = d;
  }
  const keyHandoverOn = (patch.key_handover_on as string | undefined) ?? (current.key_handover_on ? String(current.key_handover_on).slice(0, 10) : null);
  if (typeof patch.decompte_issued_on === "string" && keyHandoverOn && patch.decompte_issued_on < keyHandoverOn) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  if (has(body, "status")) {
    const to = String(body.status) as DepositStatus;
    if (!(STATES as readonly string[]).includes(to)) return NextResponse.json({ error: "invalid" }, { status: 400 });
    if (to !== from) {
      if (!depositTransitionAllowed(from, to)) return NextResponse.json({ error: "refused" }, { status: 409 });
      // A restitution cannot open before the keys are back.
      if (to === "release_pending" && !keyHandoverOn) return NextResponse.json({ error: "needs_keys" }, { status: 400 });
      if (to === "held" && !patch.received_on && !current.received_on) patch.received_on = today;
      patch.status = to;
    }
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  const { data, error } = await g.from("deposits").update(patch).eq("org_id", org.id).eq("id", id).eq("status", from).select("id");
  if (error) return dbError("deposit update", error);
  if (!data?.length) return NextResponse.json({ error: "changed" }, { status: 409 });
  return NextResponse.json({ ok: true, status: (patch.status as string | undefined) ?? from });
}

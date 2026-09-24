import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { parseEuroInput } from "@/lib/gestion/euros";
import { settlementOpen } from "@/lib/gestion/deposits";
import type { DepositStatus } from "@/lib/types";

/**
 * A retention on a guarantee whose restitution is open: arrears, damage
 * from the exit inventory, or a reserve for the charges décompte. Damage
 * without a signed entry inventory is recorded but retains nothing: the
 * law's hard gate, written on the line so nobody argues with it later.
 * Justification (an invoice or an estimate, within the month) is a step of
 * its own on the line.
 */
const KINDS = ["arrears", "damage", "charge_reserve"] as const;
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = str(body.kind, 20) as (typeof KINDS)[number];
  const label = str(body.label, 160);
  const amountCents = parseEuroInput(str(body.amount, 20));
  if (!KINDS.includes(kind) || !label || amountCents === null) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { data: deposit, error: readErr } = await g.from("deposits").select("id,lease_id,status,key_handover_on").eq("org_id", org.id).eq("id", id).maybeSingle();
  if (readErr) return dbError("deposit lookup", readErr);
  if (!deposit) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!settlementOpen(String(deposit.status) as DepositStatus, deposit.key_handover_on ? String(deposit.key_handover_on) : null)) {
    return NextResponse.json({ error: "not_open" }, { status: 409 });
  }

  let status: "pending" | "blocked_no_entry_edl" = "pending";
  if (kind === "damage") {
    const { data: entry, error: edlErr } = await g
      .from("edl_sessions")
      .select("id")
      .eq("org_id", org.id)
      .eq("lease_id", deposit.lease_id)
      .eq("kind", "entry")
      .in("status", ["signed", "sealed"])
      .limit(1);
    if (edlErr) return dbError("entry inventory lookup", edlErr);
    if (((entry as unknown[] | null) ?? []).length === 0) status = "blocked_no_entry_edl";
  }

  const { data, error } = await g
    .from("deposit_deductions")
    .insert({ org_id: org.id, deposit_id: id, kind, label, amount_cents: amountCents, status })
    .select("id")
    .single();
  if (error || !data) return dbError("deposit deduction insert", error);
  return NextResponse.json({ id: data.id, status });
}

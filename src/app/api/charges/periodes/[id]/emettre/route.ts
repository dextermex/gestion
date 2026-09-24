import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { decompteBalance } from "@/lib/gestion/charges";
import { addDays } from "@/domain/dates";

/**
 * A draft décompte is issued: dated, due a month later, and its balance
 * carried onto the ledger. What the tenant owes lands as the "other" part
 * of the first open rent period from this month on (a month somebody
 * already paid is history and is never touched); what the tenant is owed
 * is shown on the décompte and settled by hand, the ledger never invents a
 * negative rent.
 */
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const today = new Date().toISOString().slice(0, 10);
  const issuedOn = ISO.test(str(body.issuedOn, 10)) && !Number.isNaN(Date.parse(str(body.issuedOn, 10))) ? str(body.issuedOn, 10) : today;
  if (issuedOn > today) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { data: period, error: readErr } = await g
    .from("charge_periods")
    .select("id,lease_id,year,status,actual_cents,advances_billed_cents")
    .eq("org_id", org.id)
    .eq("id", id)
    .maybeSingle();
  if (readErr) return dbError("charge period lookup", readErr);
  if (!period) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (period.status !== "draft") return NextResponse.json({ error: "not_draft" }, { status: 409 });

  const dueOn = addDays(issuedOn, 30);
  const { data: issued, error: issueErr } = await g
    .from("charge_periods")
    .update({ status: "issued", issued_on: issuedOn, due_on: dueOn })
    .eq("org_id", org.id)
    .eq("id", id)
    .eq("status", "draft")
    .select("id");
  if (issueErr) return dbError("charge period issue", issueErr);
  if (!issued?.length) return NextResponse.json({ error: "not_draft" }, { status: 409 });

  const balanceCents = decompteBalance(Number(period.actual_cents) || 0, Number(period.advances_billed_cents) || 0);
  let carriedTo: string | null = null;
  if (balanceCents > 0) {
    const fromMonth = `${today.slice(0, 7)}-01`;
    const [{ data: periods, error: pErr }, { data: statuses, error: sErr }] = await Promise.all([
      g.from("rent_periods").select("id,period,other_cents,other_label").eq("org_id", org.id).eq("lease_id", period.lease_id).gte("period", fromMonth).order("period", { ascending: true }),
      g.from("rent_period_status").select("id,allocated_cents").eq("lease_id", period.lease_id),
    ]);
    if (pErr) return dbError("regularisation ledger read", pErr);
    if (sErr) return dbError("regularisation status read", sErr);
    const allocated = new Map<string, number>();
    for (const row of (statuses as Array<{ id: string; allocated_cents: number }> | null) ?? []) allocated.set(String(row.id), Number(row.allocated_cents) || 0);
    const target = ((periods as Array<{ id: string; period: string; other_cents: number; other_label: string | null }> | null) ?? []).find((p) => (allocated.get(String(p.id)) ?? 0) === 0);
    if (target) {
      const label = `Décompte ${period.year}`;
      const { error: carryErr } = await g
        .from("rent_periods")
        .update({
          other_cents: (Number(target.other_cents) || 0) + balanceCents,
          other_label: target.other_label && target.other_label !== label ? `${target.other_label} · ${label}` : label,
        })
        .eq("org_id", org.id)
        .eq("id", target.id);
      if (carryErr) return dbError("regularisation carry", carryErr);
      carriedTo = String(target.period).slice(0, 7);
    }
  }
  return NextResponse.json({ ok: true, issuedOn, dueOn, balanceCents, carriedTo });
}

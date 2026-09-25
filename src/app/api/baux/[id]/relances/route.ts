import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";

/**
 * One step of the arrears ladder, recorded on a rent period of the lease:
 * a friendly or formal reminder as done, a mise en demeure as sent by
 * registered letter (the letter is a row of its own, and legal effect will
 * run from its AR date, never from this click), the justice-de-paix file as
 * put together, which the law allows only once that AR is in hand. A step
 * already recorded for the period is refused, so the ladder never doubles.
 */
const STAGES = ["friendly", "formal", "mise_en_demeure", "justice_dossier"] as const;
type Stage = (typeof STAGES)[number];
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isoDay = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org, userId } = ctx;
  const { id: leaseId } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const stage = str(body.stage, 24) as Stage;
  const rentPeriodId = str(body.rentPeriodId, 64);
  const today = new Date().toISOString().slice(0, 10);
  const doneOn = isoDay(body.doneOn) ?? today;
  const arReceivedOn = isoDay(body.arReceivedOn);
  if (!STAGES.includes(stage) || !rentPeriodId) return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (doneOn > today || (arReceivedOn && (arReceivedOn > today || arReceivedOn < doneOn))) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const [{ data: period, error: periodErr }, { data: done, error: doneErr }] = await Promise.all([
    g.from("rent_periods").select("id,period,total_cents").eq("org_id", org.id).eq("lease_id", leaseId).eq("id", rentPeriodId).maybeSingle(),
    g.from("arrears_actions").select("id,stage,registered_letter_id,executed_at").eq("org_id", org.id).eq("rent_period_id", rentPeriodId),
  ]);
  if (periodErr) return dbError("rent period lookup", periodErr);
  if (!period) return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (doneErr) return dbError("arrears actions read", doneErr);
  const actions = (done ?? []) as Array<{ id: string; stage: string; registered_letter_id: string | null }>;
  if (actions.some((a) => a.stage === stage)) return NextResponse.json({ error: "already" }, { status: 409 });

  let letterId: string | null = null;
  if (stage === "mise_en_demeure") {
    // The recipient: the tenant of record, first named.
    const { data: parties } = await g.from("lease_parties").select("contact_id,role,moved_out_on").eq("org_id", org.id).eq("lease_id", leaseId);
    const tenant = ((parties ?? []) as Array<Record<string, unknown>>).find((p) => p.role === "tenant" && !p.moved_out_on);
    // What the letter says, kept with it: the open periods of the tenancy as
    // they stand today, the steps already taken, the amount. The document is
    // produced from this snapshot, now or later, never from rows that moved.
    const { data: statuses } = await g.from("rent_period_status").select("id,allocated_cents,status").eq("org_id", org.id).eq("lease_id", leaseId).in("status", ["late", "partial_late", "partial", "pending"]);
    const statusRows = (statuses ?? []) as Array<{ id: string; allocated_cents: number; status: string }>;
    const { data: openRows } = statusRows.length > 0
      ? await g.from("rent_periods").select("id,period,due_date,total_cents").eq("org_id", org.id).in("id", statusRows.map((r) => r.id)).order("period")
      : { data: [] };
    const allocated = new Map(statusRows.map((r) => [r.id, Number(r.allocated_cents) || 0]));
    const openPeriods = ((openRows ?? []) as Array<{ id: string; period: string; due_date: string; total_cents: number }>)
      .map((r) => ({ period: String(r.period).slice(0, 7), dueDate: String(r.due_date).slice(0, 10), totalCents: Number(r.total_cents) || 0, openCents: (Number(r.total_cents) || 0) - (allocated.get(r.id) ?? 0) }))
      .filter((r) => r.openCents > 0);
    const stepOn = (stage: string) => {
      const step = (done ?? []).find((a) => a.stage === stage) as { executed_at?: string } | undefined;
      return step?.executed_at ? String(step.executed_at).slice(0, 10) : null;
    };
    const snapshot = {
      template: "mise_en_demeure",
      lease: leaseId,
      period: String(period.period).slice(0, 7),
      amountCents: period.total_cents,
      openCents: (Number(period.total_cents) || 0) - (allocated.get(rentPeriodId) ?? 0),
      friendlyOn: stepOn("friendly"),
      formalOn: stepOn("formal"),
      openPeriods,
      dispatchedOn: doneOn,
    };
    const content = JSON.stringify(snapshot);
    const { data: letter, error: letterErr } = await g
      .from("registered_letters")
      .insert({
        org_id: org.id,
        template_key: "mise_en_demeure",
        related_type: "rent_period",
        related_id: rentPeriodId,
        recipient_contact_id: tenant ? String(tenant.contact_id) : null,
        content_sha256: createHash("sha256").update(content).digest("hex"),
        content: snapshot,
        status: arReceivedOn ? "ar_received" : "dispatched",
        dispatched_on: doneOn,
        ar_received_on: arReceivedOn,
      })
      .select("id")
      .single();
    if (letterErr || !letter) return dbError("registered letter insert", letterErr);
    letterId = String(letter.id);
  } else if (stage === "justice_dossier") {
    // The file needs the AR of the mise en demeure: the law's order, not ours.
    const med = actions.find((a) => a.stage === "mise_en_demeure");
    const { data: letter } = med?.registered_letter_id
      ? await g.from("registered_letters").select("ar_received_on").eq("org_id", org.id).eq("id", med.registered_letter_id).maybeSingle()
      : { data: null };
    if (!letter?.ar_received_on) return NextResponse.json({ error: "needs_ar" }, { status: 409 });
  }

  const { data: action, error: actionErr } = await g
    .from("arrears_actions")
    .insert({
      org_id: org.id,
      lease_id: leaseId,
      rent_period_id: rentPeriodId,
      stage,
      executed_at: `${doneOn}T12:00:00Z`,
      registered_letter_id: letterId,
      confirmed_by: userId,
    })
    .select("id")
    .single();
  if (actionErr || !action) return dbError("arrears action insert", actionErr);
  return NextResponse.json({ id: action.id, letterId });
}

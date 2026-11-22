import { createHash } from "node:crypto";
import { tenantsOfRecord } from "@/domain/arrears/recipients";
import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { adjustmentLetterState, type AdjustmentLetter } from "@/lib/gestion/indexation";
import { computeCapitalInvesti, proposeResidentialAdjustment, type CapitalComponent } from "@/domain/indexation/engine";
import { todayISO } from "@/lib/clock";

/**
 * The adjustment letter: the engine's proposal, sent to the tenant by
 * registered letter on a date. Legal effect will run from its AR date,
 * never from this click, and the adjustment itself is applied by the
 * indexation route once that AR is in hand. One letter in flight per lease.
 */
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg("write");
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const today = todayISO();
  const dispatchedOn = ISO.test(str(body.dispatchedOn, 10)) && !Number.isNaN(Date.parse(str(body.dispatchedOn, 10))) ? str(body.dispatchedOn, 10) : today;
  if (dispatchedOn > today) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { data: lease, error: findErr } = await g
    .from("leases")
    .select("id,status,lease_type,rent_cents,start_date,last_adjustment_on,capital_investi")
    .eq("org_id", org.id)
    .eq("id", id)
    .maybeSingle();
  if (findErr) return dbError("adjustment letter lease lookup", findErr);
  if (!lease) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (lease.status !== "active" && lease.status !== "notice") return NextResponse.json({ error: "lease_not_live" }, { status: 409 });
  if (lease.lease_type !== "residential") return NextResponse.json({ error: "commercial_not_supported" }, { status: 409 });

  const components = Array.isArray(lease.capital_investi) ? (lease.capital_investi as CapitalComponent[]) : [];
  const capital = computeCapitalInvesti(components, today);
  const proposal = proposeResidentialAdjustment({
    currentMonthlyRent: lease.rent_cents as number,
    lastAdjustmentDate: (lease.last_adjustment_on as string | null) ?? null,
    leaseStartDate: lease.start_date as string,
    proposedDate: today,
    capital,
  });
  if (!proposal.allowed) return NextResponse.json({ error: "not_allowed", reason: proposal.blockedReason, nextAllowedDate: proposal.nextAllowedDate }, { status: 409 });
  if (proposal.proposedMonthlyRent <= (lease.rent_cents as number)) return NextResponse.json({ error: "no_increase_available" }, { status: 409 });

  const { data: letterRows, error: lettersErr } = await g
    .from("registered_letters")
    .select("id,status,dispatched_on,ar_received_on")
    .eq("org_id", org.id)
    .eq("template_key", "rent_adjustment")
    .eq("related_type", "lease")
    .eq("related_id", id);
  if (lettersErr) return dbError("adjustment letters read", lettersErr);
  const letters: AdjustmentLetter[] = ((letterRows as Array<Record<string, unknown>> | null) ?? []).map((r) => ({
    id: String(r.id),
    status: String(r.status) as AdjustmentLetter["status"],
    dispatchedOn: r.dispatched_on ? String(r.dispatched_on).slice(0, 10) : null,
    arReceivedOn: r.ar_received_on ? String(r.ar_received_on).slice(0, 10) : null,
  }));
  if (adjustmentLetterState(letters, (lease.last_adjustment_on as string | null) ?? null).kind !== "none") {
    return NextResponse.json({ error: "already" }, { status: 409 });
  }

  // Every tenant of record this month receives it; the first is the letter's addressee.
  const { data: parties } = await g.from("lease_parties").select("id,contact_id,role,moved_in_on,moved_out_on").eq("org_id", org.id).eq("lease_id", id);
  const recipients = tenantsOfRecord((parties ?? []) as Array<Record<string, unknown>>, dispatchedOn);
  const snapshot = {
    template: "rent_adjustment",
    lease: id,
    currentRentCents: lease.rent_cents,
    proposedRentCents: proposal.proposedMonthlyRent,
    ceilingMonthlyCents: proposal.caps.ceilingMonthly,
    bindingConstraint: proposal.bindingConstraint,
    recipientContactIds: recipients,
    dispatchedOn,
  };
  const content = JSON.stringify(snapshot);
  const { data: letter, error: insertErr } = await g
    .from("registered_letters")
    .insert({
      org_id: org.id,
      template_key: "rent_adjustment",
      related_type: "lease",
      related_id: id,
      recipient_contact_id: recipients[0] ?? null,
      content_sha256: createHash("sha256").update(content).digest("hex"),
      content: snapshot,
      status: "dispatched",
      dispatched_on: dispatchedOn,
    })
    .select("id")
    .single();
  // A base without the letter's content column (0022) says it is behind, not that something failed.
  if (insertErr?.code === "PGRST204" || insertErr?.code === "42703") return NextResponse.json({ error: "schema_outdated" }, { status: 503 });
  if (insertErr || !letter) return dbError("adjustment letter insert", insertErr);
  return NextResponse.json({ id: letter.id, dispatchedOn, proposedMonthlyRent: proposal.proposedMonthlyRent });
}

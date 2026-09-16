import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { effectiveMonth, repriceOpenPeriods } from "@/lib/gestion/lease";
import { computeCapitalInvesti, proposeResidentialAdjustment } from "@/domain/indexation/engine";
import type { CapitalComponent } from "@/domain/indexation/engine";

/**
 * Applying a rent adjustment.
 *
 * The engine decides whether one is lawful and how large it may be; this
 * route re-runs it server-side and applies its answer. A client cannot talk
 * Morada into a number the engine did not produce — the amount in the request
 * is ignored entirely, and a proposal the engine refuses is refused here with
 * the reason it gave.
 *
 * The lease keeps its previous rent and the date of the adjustment, which is
 * what the 24-month rule and the standing-order lag detector read next time.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id } = await params;
  const today = new Date().toISOString().slice(0, 10);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const { data: lease, error: findErr } = await g
    .from("leases")
    .select("id,status,lease_type,rent_cents,charges_cents,start_date,last_adjustment_on,capital_investi")
    .eq("org_id", org.id)
    .eq("id", id)
    .maybeSingle();
  if (findErr) return dbError("indexation lease lookup", findErr);
  if (!lease) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (lease.status !== "active" && lease.status !== "notice") {
    return NextResponse.json({ error: "lease_not_live" }, { status: 409 });
  }
  if (lease.lease_type !== "residential") {
    // Commercial clauses index on a published IPC value, which Morada has no
    // production feed for yet. Refusing is the honest answer.
    return NextResponse.json({ error: "commercial_not_supported" }, { status: 409 });
  }

  const components = Array.isArray(lease.capital_investi) ? (lease.capital_investi as CapitalComponent[]) : [];
  const capital = computeCapitalInvesti(components, today);
  const proposal = proposeResidentialAdjustment({
    currentMonthlyRent: lease.rent_cents as number,
    lastAdjustmentDate: (lease.last_adjustment_on as string | null) ?? null,
    leaseStartDate: lease.start_date as string,
    proposedDate: today,
    capital,
  });
  if (!proposal.allowed) {
    return NextResponse.json(
      { error: "not_allowed", reason: proposal.blockedReason, nextAllowedDate: proposal.nextAllowedDate },
      { status: 409 },
    );
  }
  if (proposal.proposedMonthlyRent <= (lease.rent_cents as number)) {
    return NextResponse.json({ error: "no_increase_available" }, { status: 409 });
  }

  const effective = effectiveMonth(typeof body.effectiveFrom === "string" ? body.effectiveFrom : null);
  const { data, error } = await g
    .from("leases")
    .update({
      rent_cents: proposal.proposedMonthlyRent,
      previous_rent_cents: lease.rent_cents,
      last_adjustment_on: effective.slice(0, 10),
    })
    .eq("org_id", org.id)
    .eq("id", id)
    .select("id");
  if (error) return dbError("indexation update", error);
  if (!data?.length) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const repriced = await repriceOpenPeriods(
    ctx,
    id,
    proposal.proposedMonthlyRent,
    lease.charges_cents as number,
    effective,
  );
  return NextResponse.json({
    ok: true,
    previousRentCents: lease.rent_cents,
    newRentCents: proposal.proposedMonthlyRent,
    bindingConstraint: proposal.bindingConstraint,
    effectiveFrom: effective.slice(0, 10),
    repriced,
  });
}

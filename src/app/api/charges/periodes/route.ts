import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { parseEuroInput } from "@/lib/gestion/euros";
import { advancesBilledForYear, CHARGE_SOURCES, computeChargePeriod, decompteBalance, type ChargeLineInput, type ChargeSource } from "@/lib/gestion/charges";
import type { ChargeCategory } from "@/domain/charges/recharge";

/**
 * A charges décompte for a tenancy and a year, saved as a draft: its lines
 * as the desk entered them (a building total split by tantièmes, or the
 * lot's share directly), each line's tenant share decided by the recharge
 * engine (a residential hard block leaves it visible and at zero), and the
 * advances the ledger actually billed that year. One per lease and year.
 */
const MAX_LINES = 60;
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isInteger(n) ? n : null;
};
const money = (v: unknown): number | null | undefined => {
  const raw = typeof v === "number" ? String(v) : str(v, 20);
  if (raw === "") return undefined;
  const cents = parseEuroInput(raw);
  return cents === null ? null : cents;
};

export async function POST(req: NextRequest) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org, userId } = ctx;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const leaseId = str(body.leaseId, 64);
  const year = int(body.year);
  const today = new Date().toISOString().slice(0, 10);
  const thisYear = Number(today.slice(0, 4));
  const rawLines = Array.isArray(body.lines) ? (body.lines as unknown[]) : [];
  if (!leaseId || year === null || year < 2000 || year > thisYear + 1 || rawLines.length === 0 || rawLines.length > MAX_LINES) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const { data: lease, error: leaseErr } = await g.from("leases").select("id,lease_type,charges_regime").eq("org_id", org.id).eq("id", leaseId).maybeSingle();
  if (leaseErr) return dbError("charge period lease lookup", leaseErr);
  if (!lease) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const leaseType = lease.lease_type === "commercial" ? "commercial" : "residential";

  const inputs: ChargeLineInput[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const l = (rawLines[i] ?? {}) as Record<string, unknown>;
    const buildingTotal = money(l.buildingTotal);
    const lotShare = money(l.lotShare);
    // A figure that does not read as money is a problem on that line, not a blank.
    if (buildingTotal === null || lotShare === null) return NextResponse.json({ error: "invalid", problem: "share", index: i }, { status: 400 });
    const source = str(l.source, 20) as ChargeSource;
    inputs.push({
      label: str(l.label, 160),
      category: str(l.category, 40) as ChargeCategory,
      source: (CHARGE_SOURCES as readonly string[]).includes(source) ? source : "invoice",
      buildingTotalCents: buildingTotal ?? null,
      tantiemes: int(l.tantiemes),
      tantiemesTotal: int(l.tantiemesTotal),
      lotShareCents: lotShare ?? null,
    });
  }
  const computed = computeChargePeriod(inputs, leaseType);
  if ("problem" in computed) return NextResponse.json({ error: "invalid", problem: computed.problem, index: computed.index }, { status: 400 });

  const { data: periods, error: periodsErr } = await g.from("rent_periods").select("period,charges_cents").eq("org_id", org.id).eq("lease_id", leaseId);
  if (periodsErr) return dbError("charge period ledger read", periodsErr);
  const advancesBilledCents = advancesBilledForYear(
    ((periods as Array<{ period: string; charges_cents: number }> | null) ?? []).map((p) => ({ period: String(p.period).slice(0, 7), chargesCents: Number(p.charges_cents) || 0 })),
    year,
  );

  const { data: period, error: insertErr } = await g
    .from("charge_periods")
    .insert({ org_id: org.id, lease_id: leaseId, year, regime: lease.charges_regime === "forfait" ? "forfait" : "advances", status: "draft", advances_billed_cents: advancesBilledCents, actual_cents: computed.actualCents })
    .select("id")
    .single();
  if (insertErr || !period) {
    if (insertErr?.code === "23505") return NextResponse.json({ error: "exists" }, { status: 409 });
    return dbError("charge period insert", insertErr);
  }

  const { error: linesErr } = await g.from("charge_lines").insert(
    computed.lines.map((l) => ({
      org_id: org.id,
      charge_period_id: period.id,
      source: l.source,
      label: l.label,
      category: l.category,
      building_total_cents: l.buildingTotalCents,
      tantiemes: l.tantiemes,
      tantiemes_total: l.tantiemesTotal,
      lot_share_cents: l.lotShareCents,
      tenant_share_cents: l.tenantShareCents,
      blocked: l.blocked,
      block_reason: l.blockReason,
      provenance: { enteredBy: userId, enteredOn: today },
    })),
  );
  if (linesErr) {
    // A period without its lines is not a décompte: it goes with the failure.
    await g.from("charge_periods").delete().eq("org_id", org.id).eq("id", period.id);
    return dbError("charge lines insert", linesErr);
  }
  return NextResponse.json({
    id: period.id,
    actualCents: computed.actualCents,
    blockedCents: computed.blockedCents,
    advancesBilledCents,
    balanceCents: decompteBalance(computed.actualCents, advancesBilledCents),
  });
}

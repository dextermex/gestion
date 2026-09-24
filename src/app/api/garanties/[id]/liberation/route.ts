import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { loadSettlement } from "@/lib/gestion/deposit-settlement";
import { releaseDecision, settlementOpen, type Tranche } from "@/lib/gestion/deposits";

/**
 * Money leaves the guarantee here and nowhere else: the first tranche once
 * the keys are back, the balance once the décompte is out. The amount is
 * the settlement engine's, computed on the rows as they stand; the request
 * only names the tranche. Released cents and the status that follows are
 * written together, against the status the caller saw.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const tranche = body.tranche === "balance" ? "balance" : body.tranche === "first" ? "first" : null;
  if (!tranche) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const today = new Date().toISOString().slice(0, 10);

  const loaded = await loadSettlement(ctx, id, today);
  if ("error" in loaded) return loaded.error === "not_found" ? NextResponse.json({ error: "not_found" }, { status: 404 }) : dbError(loaded.context, loaded.detail);
  const { deposit, settlement } = loaded;
  if (!settlement || !settlementOpen(deposit.status, deposit.keyHandoverOn)) return NextResponse.json({ error: "not_open" }, { status: 409 });

  const decision = releaseDecision(tranche as Tranche, settlement, deposit);
  if ("refused" in decision) return NextResponse.json({ error: decision.refused }, { status: 409 });

  const patch: Record<string, unknown> = { status: decision.nextStatus };
  if (tranche === "first") patch.released_first_tranche_cents = deposit.releasedFirstTrancheCents + decision.amountCents;
  else patch.released_balance_cents = deposit.releasedBalanceCents + decision.amountCents;
  const { data, error } = await g.from("deposits").update(patch).eq("org_id", org.id).eq("id", id).eq("status", deposit.status).select("id");
  if (error) return dbError("deposit release", error);
  if (!data?.length) return NextResponse.json({ error: "changed" }, { status: 409 });
  return NextResponse.json({ ok: true, tranche, amountCents: decision.amountCents, status: decision.nextStatus });
}

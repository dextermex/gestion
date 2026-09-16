import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { parseEuroInput } from "@/lib/gestion/euros";
import { CLOSURE_OUTCOMES, closeLease, type ClosureOutcome } from "@/lib/gestion/lease";

/**
 * A tenant leaves. The route only reads the form; `closeLease` is the one
 * place that knows how a tenancy ends without destroying anything.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const outcome = (CLOSURE_OUTCOMES as readonly string[]).includes(String(body.depositOutcome))
    ? (String(body.depositOutcome) as ClosureOutcome)
    : "release_pending";

  const result = await closeLease(ctx, id, {
    endDate: ISO.test(str(body.endDate, 10)) ? str(body.endDate, 10) : null,
    depositOutcome: outcome,
    releasedCents: parseEuroInput(str(body.releasedAmount, 20)) ?? 0,
    keysReturned: body.keysReturned === true,
    decompteIssuedOn: ISO.test(str(body.decompteIssuedOn, 10)) ? str(body.decompteIssuedOn, 10) : null,
  });

  if ("error" in result) {
    if (result.error === "storage_failed") return dbError(result.context, result.detail);
    const status = result.error === "not_found" ? 404 : result.error === "already_ended" ? 409 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json(result);
}

import { NextRequest, NextResponse } from "next/server";
import { withOrg } from "@/lib/gestion/api";
import { cancelPayment } from "@/lib/banking/cancel";

/**
 * Cancels a payment: its allocations are reversed, the periods it covered
 * are open again, and the bank operation it came from returns to the review
 * queue. The payment row stays, with who cancelled it, when and the reason
 * given. Refused (409 `receipt_issued`) when a quittance was produced for a
 * month it paid. The base checks the caller's right on the payment's own
 * workspace: an id from elsewhere answers 404.
 */
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg("write");
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // The payment is looked up in the active workspace first: the cancellation never reaches a row of another one.
  const { data: payment, error: findErr } = await ctx.g.from("payments").select("id").eq("org_id", ctx.org.id).eq("id", id).maybeSingle();
  if (findErr && findErr.code !== "22P02") {
    console.error("payment lookup failed:", findErr.code, findErr.message);
    return NextResponse.json({ error: "storage_failed" }, { status: 502 });
  }
  if (!payment) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = await cancelPayment(ctx.g, id, str(body.reason, 500) || null);
  if ("error" in result) {
    const status = result.error === "not_found" ? 404 : result.error === "receipt_issued" ? 409 : result.error === "schema_outdated" ? 503 : 502;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, already: result.already, reopened: result.bankTransactionId !== null });
}

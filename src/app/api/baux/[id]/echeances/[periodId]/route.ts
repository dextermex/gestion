import { NextRequest, NextResponse } from "next/server";
import { withOrg } from "@/lib/gestion/api";
import { parseEuroInput } from "@/lib/gestion/euros";
import { adjustPeriod } from "@/lib/gestion/lease";

/**
 * Setting one month's amount: `{ prorata: true }` cuts the first or last
 * month of a tenancy to the days it covers; `{ rent, charges, reason }`
 * states the amount by hand, with its reason. A month something was paid on
 * (409 `paid`), written off (409 `written_off`), already set to its share
 * (409 `already_adjusted`) or covered whole (409 `not_partial`) is refused.
 */
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; periodId: string }> }) {
  const ctx = await withOrg("write");
  if (ctx instanceof NextResponse) return ctx;
  const { id, periodId } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  let result: Awaited<ReturnType<typeof adjustPeriod>>;
  if (body.prorata === true) {
    result = await adjustPeriod(ctx, id, periodId, { prorata: true, reason: str(body.reason, 300) });
  } else {
    // An amount of nothing is a month waived: "0" reads as zero here.
    const amount = (v: unknown): number | null => {
      const raw = str(v, 20);
      if (raw === "" || /^0+([.,]0+)?$/.test(raw.replace(/[\s  €]/g, ""))) return 0;
      return parseEuroInput(raw);
    };
    const rentCents = amount(body.rent);
    const chargesCents = amount(body.charges);
    const reason = str(body.reason, 300);
    if (rentCents === null || chargesCents === null || reason === "") return NextResponse.json({ error: "invalid" }, { status: 400 });
    result = await adjustPeriod(ctx, id, periodId, { rentCents, chargesCents, reason });
  }
  if ("error" in result) {
    const status = result.error === "not_found" ? 404 : result.error === "invalid" ? 400 : result.error === "storage_failed" ? 502 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json(result);
}

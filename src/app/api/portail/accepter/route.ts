import { NextRequest, NextResponse } from "next/server";
import { acceptInvitation } from "@/lib/portal/accept";
import { withTenant } from "@/lib/portal/session";

/**
 * The one call that links a signed-in account to its lease. The token is
 * the only input; the account comes from the verified session; the database
 * checks everything else inside one transaction, so a double click or a
 * second tab gets the same answer as the first.
 */
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: NextRequest) {
  const ctx = await withTenant();
  if (ctx instanceof NextResponse) return ctx;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const token = str(body.token, 200);
  if (token.length < 32) return NextResponse.json({ error: "unknown" }, { status: 404 });
  const result = await acceptInvitation(ctx.g, token);
  if ("error" in result) {
    const status =
      result.error === "sign_in" ? 401 : result.error === "unknown" ? 404 : result.error === "storage_failed" ? 502 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, leaseId: result.leaseId, already: result.already });
}

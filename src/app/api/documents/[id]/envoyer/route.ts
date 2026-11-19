import { NextRequest, NextResponse } from "next/server";
import { withOrgAndClient } from "@/lib/gestion/api";
import { RATE, refuseOverRate } from "@/lib/gestion/rate-limit";
import { sendDocumentByMail } from "@/lib/delivery/outbox";

/**
 * A piece of a tenancy, mailed to its tenants with the file attached: one
 * line of the outbox per address, saying whether it left. A piece that is
 * not the workspace's, not a lease's, or has no file is not found; a lease
 * whose tenants have no address has nobody to write to.
 */
export const runtime = "nodejs";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrgAndClient("write");
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  // A file mailed from Morada's sender: counted per person and per workspace.
  const limited = await refuseOverRate(ctx.g, RATE.mailDocument, ctx.org.id);
  if (limited) return limited;
  const result = await sendDocumentByMail(ctx, ctx.client, id);
  if ("error" in result) {
    const status = result.error === "not_found" ? 404 : result.error === "no_recipient" ? 409 : 502;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, name: result.name, deliveries: result.deliveries }, { status: 201 });
}

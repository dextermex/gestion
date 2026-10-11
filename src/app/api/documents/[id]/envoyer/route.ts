import { NextRequest, NextResponse } from "next/server";
import { rateLimited, requirePerm, withOrgAndClient } from "@/lib/gestion/api";
import { sendDocumentByMail, takeMailQuota } from "@/lib/delivery/outbox";

/**
 * A piece of a tenancy, mailed to its tenants with the file attached: one
 * line of the outbox per address, saying whether it left. A piece that is
 * not the workspace's, not a lease's, or has no file is not found; a lease
 * whose tenants have no address has nobody to write to. Only someone who
 * may write to the register (the permission the outbox's own line needs)
 * may send, and within their mail allowance: the check comes before the
 * e-mail leaves, not after.
 */
export const runtime = "nodejs";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrgAndClient("write");
  if (ctx instanceof NextResponse) return ctx;
  const refused = await requirePerm(ctx, "gestion.documents.edit");
  if (refused) return refused;
  const quota = await takeMailQuota(ctx);
  if (!quota.ok) return rateLimited(quota.retryAfterSec);
  const { id } = await params;
  const result = await sendDocumentByMail(ctx, ctx.client, id);
  if ("error" in result) {
    const status = result.error === "not_found" ? 404 : result.error === "no_recipient" ? 409 : 502;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, name: result.name, deliveries: result.deliveries }, { status: 201 });
}

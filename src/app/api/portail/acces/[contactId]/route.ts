import { NextRequest, NextResponse } from "next/server";
import { withOrg } from "@/lib/gestion/api";
import { unlinkTenantAccount } from "@/lib/portal/access";

/**
 * "Retirer l'accès": the person's account no longer opens this workspace's
 * tenant space; their open invitations stop working. The contact stays, and
 * can be invited again. 404 for a contact of another workspace or one the
 * caller may not edit, 409 `not_linked` when no account was linked.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ contactId: string }> }) {
  const ctx = await withOrg("write");
  if (ctx instanceof NextResponse) return ctx;
  const { contactId } = await params;
  const result = await unlinkTenantAccount(ctx, contactId);
  if ("error" in result) {
    const status = result.error === "not_found" ? 404 : result.error === "not_linked" ? 409 : 502;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, revoked: result.revoked });
}

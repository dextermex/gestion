import { NextRequest, NextResponse } from "next/server";
import { withOrg } from "@/lib/gestion/api";
import { revokeInvitation } from "@/lib/portal/invitations";

/** "Révoquer": the link stops working; the row stays, dated, as history. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const result = await revokeInvitation(ctx, id);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.error === "forbidden" ? 403 : 502 });
  return NextResponse.json({ ok: true });
}

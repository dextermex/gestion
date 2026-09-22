import { NextRequest, NextResponse } from "next/server";
import { withOrg } from "@/lib/gestion/api";
import { addManagerMessage, statusOfFailure } from "@/lib/gestion/requests";

/**
 * The desk's first word to a tenancy: opens the lease's conversation if
 * nobody has written yet, and writes on it. The lease must belong to the
 * active workspace; one from elsewhere is not found.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const result = await addManagerMessage(ctx, { leaseId: id }, body.body);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: statusOfFailure(result.error) });
  return NextResponse.json({ ok: true, id: result.id, conversationId: result.conversationId });
}

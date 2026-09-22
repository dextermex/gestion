import { NextRequest, NextResponse } from "next/server";
import { withOrg } from "@/lib/gestion/api";
import { parseRequestStatus, setRequestStatus, statusOfFailure } from "@/lib/gestion/requests";

/**
 * The owner's status on a tenant request: to handle, in progress, resolved
 * or refused. The request is looked up in the active workspace under the
 * caller's own token; one from elsewhere is not found.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const status = parseRequestStatus(body.status);
  if (!status) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await setRequestStatus(ctx, id, status);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: statusOfFailure(result.error) });
  return NextResponse.json({ ok: true, status: result.status });
}

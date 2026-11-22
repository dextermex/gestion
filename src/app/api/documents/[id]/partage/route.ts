import { NextRequest, NextResponse } from "next/server";
import { withOrg } from "@/lib/gestion/api";
import { shareDocument } from "@/lib/gestion/documents";

/**
 * Whether a piece of a tenancy is in front of its tenants: the desk shares
 * it, or takes it back. Only a piece of the active workspace that hangs off
 * a lease; the tenant's own policy then reads the flag, so nothing is
 * copied anywhere.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg("write");
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.shared !== "boolean") return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await shareDocument(ctx, id, body.shared);
  if ("error" in result) {
    const status = result.error === "not_found" ? 404 : result.error === "forbidden" ? 403 : result.error === "schema_outdated" ? 503 : 502;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, shared: result.shared });
}

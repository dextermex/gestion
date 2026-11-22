import { NextRequest, NextResponse } from "next/server";
import { withOrg } from "@/lib/gestion/api";
import { PARTY_ROLES, addLeaseParty, type PartyRole } from "@/lib/gestion/lease";

/**
 * Someone joins a tenancy in force: a co-tenant, a guarantor. `contactId`
 * names a contact of the workspace, `role` is `tenant` or `guarantor`,
 * `movedInOn` (YYYY-MM-DD) the day they are in, today when left out.
 */
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg("write");
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
  const role = (PARTY_ROLES as readonly string[]).includes(String(body.role)) ? (String(body.role) as PartyRole) : null;
  const asked = typeof body.movedInOn === "string" ? body.movedInOn.trim() : "";
  if (!contactId || !role || (asked !== "" && !ISO.test(asked))) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await addLeaseParty(ctx, id, { contactId, role, movedInOn: asked || null });
  if ("error" in result) {
    const status = result.error === "not_found" ? 404 : result.error === "invalid" ? 400 : result.error === "storage_failed" ? 502 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, id: result.id });
}

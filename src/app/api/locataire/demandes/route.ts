import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/portal/session";
import { createTenantRequest, parseRequestInput } from "@/lib/portal/requests";
import { leaseSubject, ticketRef } from "@/lib/portal/types";

/**
 * A tenant's new request. The lease it lands on is not taken from the
 * request: it is the tenancy in force that `my_home()` returns for this
 * account, so a forged id changes nothing. The request then takes its place
 * in the tenancy's conversation. Photos are not part of this body: the
 * browser sends them afterwards to `/api/locataire/demandes/[id]/pieces`,
 * which stores each file and only then records it, so no document row ever
 * names a file that does not exist.
 */
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: NextRequest) {
  const ctx = await withTenant();
  if (ctx instanceof NextResponse) return ctx;
  const { g, session } = ctx;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const input = parseRequestInput(body);
  if (!input) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { data: homes, error: homeErr } = await g.rpc("my_home");
  if (homeErr) return NextResponse.json({ error: "storage_failed" }, { status: 502 });
  const rows = ((homes as Array<Record<string, unknown>> | null) ?? []).filter((h) => h.lease_status === "active" || h.lease_status === "notice");
  const wanted = str(body.leaseId, 64);
  const home = (wanted ? rows.find((h) => h.lease_id === wanted) : rows[0]) ?? null;
  if (!home) return NextResponse.json({ error: "no_live_lease" }, { status: 409 });
  const lease = {
    id: String(home.lease_id),
    orgId: String(home.org_id),
    unitId: String(home.unit_id),
    propertyId: String(home.property_id),
    subject: leaseSubject(String(home.unit_label ?? ""), String(home.property_name ?? "")),
  };
  const user = { id: session.userId };

  const created = await createTenantRequest(g, user, lease, input);
  if ("error" in created) {
    return NextResponse.json({ error: created.error }, { status: created.error === "forbidden" ? 403 : created.error === "invalid" ? 400 : 502 });
  }

  return NextResponse.json({ ok: true, id: created.id, ref: ticketRef(created.id), conversationId: created.conversationId });
}

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/portal/session";
import { addTenantMessage } from "@/lib/portal/requests";
import { leaseSubject } from "@/lib/portal/types";

/**
 * A message from the tenant to their manager, in the tenancy's own
 * conversation. The tenancy is not taken from the request: it is one of
 * the leases `my_home()` returns for this account (the one named, if it is
 * theirs, else the one in force, else the latest), so a forged id changes
 * nothing.
 */
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const LIVE = new Set(["active", "notice"]);

export async function POST(req: NextRequest) {
  const ctx = await withTenant();
  if (ctx instanceof NextResponse) return ctx;
  const { g, session } = ctx;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const text = str(body.body, 4000);
  if (!text) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { data: homes, error: homeErr } = await g.rpc("my_home");
  if (homeErr) return NextResponse.json({ error: "storage_failed" }, { status: 502 });
  const rows = ((homes as Array<Record<string, unknown>> | null) ?? []).slice().sort((a, b) => (String(a.start_date) < String(b.start_date) ? 1 : -1));
  const wanted = str(body.leaseId, 64);
  const home = (wanted ? rows.find((h) => h.lease_id === wanted) : (rows.find((h) => LIVE.has(String(h.lease_status))) ?? rows[0])) ?? null;
  if (!home) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const lease = { id: String(home.lease_id), orgId: String(home.org_id), subject: leaseSubject(String(home.unit_label ?? ""), String(home.property_name ?? "")) };
  const result = await addTenantMessage(g, { id: session.userId }, lease, text);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.error === "forbidden" ? 403 : result.error === "invalid" ? 400 : 502 });
  }
  return NextResponse.json({ ok: true, id: result.id, conversationId: result.conversationId });
}

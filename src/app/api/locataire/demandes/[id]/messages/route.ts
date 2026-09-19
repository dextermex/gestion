import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/portal/session";
import { addTenantMessage } from "@/lib/portal/requests";

/**
 * A follow-up on one of the tenant's own requests. The request is read
 * back under the tenant's token first: a ticket that is not theirs simply
 * does not exist here, and the message goes nowhere.
 */
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withTenant();
  if (ctx instanceof NextResponse) return ctx;
  const { g, session } = ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const text = str(body.body, 4000);
  if (!text) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { data: ticket, error } = await g.from("tickets").select("id,org_id,title,lease_id").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: "storage_failed" }, { status: 502 });
  if (!ticket) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = await addTenantMessage(g, { id: session.userId }, { orgId: String(ticket.org_id) }, { id: String(ticket.id), title: String(ticket.title ?? "") }, text);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.error === "forbidden" ? 403 : result.error === "invalid" ? 400 : 502 });
  }
  return NextResponse.json({ ok: true, id: result.id });
}

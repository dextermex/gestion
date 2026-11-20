import { NextRequest, NextResponse } from "next/server";
import { withOrgAndClient } from "@/lib/gestion/api";
import { sendDocumentByMail } from "@/lib/delivery/outbox";
import { getI18n } from "@/lib/i18n";
import { dayOf } from "@/lib/clock";
import { formatDate } from "@/lib/types";

/**
 * A piece of a tenancy, mailed to its tenants with the file attached: one
 * line of the outbox per address, saying whether it left. A piece that is
 * not the workspace's, not a lease's, or has no file is not found; a lease
 * whose tenants have no address has nobody to write to. A piece that
 * already left is sent again only when the body says `again`; otherwise the
 * answer is 409 `already_sent`, with to whom and on which day.
 */
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrgAndClient("write");
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await sendDocumentByMail(ctx, ctx.client, id, { again: body.again === true });
  if ("error" in result) {
    if (result.error === "already_sent") {
      const { locale } = await getI18n();
      const sentOn = result.sentAt ? formatDate(dayOf(result.sentAt), locale) : "";
      return NextResponse.json({ error: "already_sent", emails: result.emails ?? [], sentOn }, { status: 409 });
    }
    const status = result.error === "not_found" ? 404 : result.error === "no_recipient" ? 409 : 502;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, name: result.name, deliveries: result.deliveries }, { status: 201 });
}

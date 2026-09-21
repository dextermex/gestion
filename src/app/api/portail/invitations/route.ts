import { NextRequest, NextResponse } from "next/server";
import { withOrg } from "@/lib/gestion/api";
import { getDict, getI18n } from "@/lib/i18n";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import { formatDate } from "@/lib/types";
import { sendInvitation } from "@/lib/portal/invitations";
import { APP_URL } from "@/lib/constants";

/**
 * "Inviter le locataire": the owner names a party of a live lease, the
 * database mints the invitation, the e-mail goes out when the deployment
 * can send one, and the link comes back either way so the owner can hand
 * it over. The e-mail is written in the tenant's own language when the
 * contact records one, else in the owner's.
 */
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: NextRequest) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const leaseId = str(body.leaseId, 64);
  const contactId = str(body.contactId, 64);
  if (!leaseId || !contactId) return NextResponse.json({ error: "invalid" }, { status: 400 });

  // What the e-mail says, read under the owner's own token.
  const [{ data: lease }, { data: contact }] = await Promise.all([
    g.from("leases").select("id,unit_id").eq("org_id", org.id).eq("id", leaseId).maybeSingle(),
    g.from("contacts").select("id,first_name,display_name,language").eq("org_id", org.id).eq("id", contactId).maybeSingle(),
  ]);
  if (!lease || !contact) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { data: unit } = await g.from("units").select("id,label,property_id").eq("org_id", org.id).eq("id", lease.unit_id).maybeSingle();
  const { data: property } = unit
    ? await g.from("properties").select("id,name").eq("org_id", org.id).eq("id", unit.property_id).maybeSingle()
    : { data: null };

  const { locale, d } = await getI18n();
  const tenantLocale = (LOCALES as readonly string[]).includes(String(contact.language ?? "")) ? (contact.language as Locale) : locale;
  const dict = tenantLocale === locale ? d : getDict(tenantLocale);

  const outcome = await sendInvitation(ctx, dict, {
    leaseId,
    contactId,
    baseUrl: APP_URL,
    vars: {
      firstName: String(contact.first_name ?? "") || String(contact.display_name ?? "").split(" ")[0] || "",
      orgName: org.name,
      propertyName: String(property?.name ?? ""),
      unitLabel: String(unit?.label ?? ""),
    },
    formatDate: (iso) => formatDate(iso.slice(0, 10), tenantLocale),
  });
  if ("error" in outcome) {
    const status = outcome.error === "not_found" ? 404 : outcome.error === "forbidden" ? 403 : outcome.error === "storage_failed" ? 502 : 409;
    return NextResponse.json({ error: outcome.error }, { status });
  }
  return NextResponse.json({ ok: true, ...outcome });
}

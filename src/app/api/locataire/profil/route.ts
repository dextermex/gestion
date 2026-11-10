import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { addTenantMessage } from "@/lib/portal/requests";
import { withTenant } from "@/lib/portal/session";
import { leaseSubject } from "@/lib/portal/types";
import { updateSignupUser } from "@/lib/signup/update-user";
import { authedClient } from "@/lib/supabase/server";

/**
 * The tenant's own account, saved under their own token.
 *
 *   details  first and last name, on their profile row (its own-row policy
 *            decides) and on the account's metadata, the way sign-up wrote
 *            them.
 *   sync     after the tenant confirmed a new e-mail or mobile with the
 *            code the account system sent them: the profile row takes the
 *            mobile the account system now holds. Nothing here changes a
 *            sign-in detail; the account system did, on its own check.
 *   locale   the language the tenant chose, kept with the profile.
 *
 * With `notify`, the manager is told in the tenancy's own conversation, in
 * the tenant's name, so the lease file can be brought up to date: the file
 * itself is the landlord's and nothing here writes to it. Same origin only,
 * as the sign-up route: the session is a cookie.
 */
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("details"), firstName: z.string().trim().min(1).max(60), lastName: z.string().trim().min(1).max(60), notify: z.boolean().optional() }),
  z.object({ action: z.literal("sync"), notify: z.boolean().optional() }),
  z.object({ action: z.literal("locale"), locale: z.enum(["fr", "en", "de", "lu"]) }),
]);

const LIVE = new Set(["active", "notice"]);

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const ctx = await withTenant();
  if (ctx instanceof NextResponse) return ctx;
  const { g, session } = ctx;
  const db = authedClient(session.accessToken);
  const body = parsed.data;

  if (body.action === "locale") {
    const { error } = await db.from("profiles").update({ preferred_language: body.locale }).eq("id", session.userId);
    if (error) return NextResponse.json({ error: "save_failed" }, { status: 502 });
    await updateSignupUser(session.accessToken, { data: { preferred_language: body.locale } });
    return NextResponse.json({ ok: true });
  }

  // The account system is the authority on who this is and how they sign in.
  const { data: auth, error: authError } = await db.auth.getUser(session.accessToken);
  const user = auth.user;
  if (authError || !user) return NextResponse.json({ error: "session_expired" }, { status: 401 });
  const phone = user.phone ? `+${user.phone.replace(/^\+/, "")}` : null;

  let name: string;
  if (body.action === "details") {
    const { data, error } = await db.from("profiles").update({ first_name: body.firstName, last_name: body.lastName }).eq("id", session.userId).select("id").maybeSingle();
    if (error || !data) return NextResponse.json({ error: "save_failed" }, { status: 502 });
    const saved = await updateSignupUser(session.accessToken, { data: { first_name: body.firstName, last_name: body.lastName } });
    if (saved.error) return NextResponse.json({ error: "save_failed" }, { status: 502 });
    name = `${body.firstName} ${body.lastName}`;
  } else {
    const { data, error } = await db.from("profiles").update({ phone }).eq("id", session.userId).select("first_name,last_name").maybeSingle();
    if (error || !data) return NextResponse.json({ error: "save_failed" }, { status: 502 });
    name = `${String(data.first_name ?? "")} ${String(data.last_name ?? "")}`.trim();
  }

  let notified = false;
  if (body.notify) {
    // The tenancy is not taken from the request: it is the one in force that `my_home()` returns for this account.
    const { data: homes } = await g.rpc("my_home");
    const rows = ((homes as Array<Record<string, unknown>> | null) ?? []).filter((h) => LIVE.has(String(h.lease_status))).sort((a, b) => (String(a.start_date) < String(b.start_date) ? 1 : -1));
    const home = rows[0];
    if (home) {
      const { d } = await getI18n();
      const text = fmt(d.tenant.noticeBody, { name: name || user.email || "", email: user.email ?? "", phone: phone ?? d.common.none });
      const lease = { id: String(home.lease_id), orgId: String(home.org_id), subject: leaseSubject(String(home.unit_label ?? ""), String(home.property_name ?? "")) };
      const sent = await addTenantMessage(g, { id: session.userId }, lease, text);
      notified = !("error" in sent);
    }
  }
  return NextResponse.json({ ok: true, notified });
}

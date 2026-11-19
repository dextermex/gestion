import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { render, categoryOf, type Kind, type Severity } from "./templates.ts";

/**
 * The notification engine for the Morada app. Three callers:
 *
 *  - the database, through pg_net, with the vault's shared secret:
 *    `{mode:"event", table, op, new, old}` from row triggers and
 *    `{mode:"tick"}` from pg_cron every fifteen minutes;
 *  - the app, with the person's own JWT: `{mode:"test"}` sends one
 *    notification to the caller so they can see the channel works;
 *  - the bank function, with the secret: `{mode:"notify", org_id, kind, args}`.
 *
 * Every notification lands in gestion.notifications (the in-app inbox) and
 * is pushed through Expo to the person's devices, unless their preferences
 * say no for that category. Quiet hours (21:00 to 08:00 in Luxembourg)
 * hold the push, never the inbox row; an emergency ticket goes through at
 * any hour. Reminders are deduplicated by (person, key), so a tick may run
 * twice without saying anything twice.
 *
 * The service role is used here only, on the server, to read across
 * organisations; nothing of it ever reaches a device.
 */
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "sb_publishable_op56tIbcBkl6dOI7ZHdO7w_YzW4TAm3";
const EXPO_PUSH = "https://exp.host/--/api/v2/push/send";
const TZ = "Europe/Luxembourg";
const QUIET_FROM = 21;
const QUIET_TO = 8;

type Row = Record<string, any>;
interface Draft {
  org_id: string;
  kind: Kind;
  args: Record<string, string>;
  href?: string;
  dedupe_key: string;
  severity?: Severity;
  data?: Record<string, unknown>;
  /** Restrict to these people (otherwise every active member of the org). */
  only?: string[];
}

const admin = (): SupabaseClient => createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: "gestion" }, auth: { persistSession: false } });

// ─── Time and words ─────────────────────────────────────────────────────────

function luxParts(d = new Date()): { date: string; hour: number; minute: number; day: number; month: number; year: number } {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute), day: Number(p.day), month: Number(p.month), year: Number(p.year) };
}

const intl = (lang: string) => (lang === "en" ? "en-GB" : lang === "de" ? "de-LU" : "fr-LU");
const euros = (cents: number, lang: string) => new Intl.NumberFormat(intl(lang), { style: "currency", currency: "EUR", maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
const dateWords = (iso: string, lang: string) => new Intl.DateTimeFormat(intl(lang), { day: "numeric", month: "long", timeZone: TZ }).format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso));
const timeWords = (iso: string, lang: string) => new Intl.DateTimeFormat(intl(lang), { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(iso));
const monthWords = (iso: string, lang: string) => new Intl.DateTimeFormat(intl(lang), { month: "long", year: "numeric", timeZone: TZ }).format(new Date(`${iso.slice(0, 7)}-01T12:00:00Z`));
const daysBetween = (a: string, b: string) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86_400_000);
const addDays = (iso: string, n: number) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n)).toISOString().slice(0, 10);
const addYears = (iso: string, n: number) => `${+iso.slice(0, 4) + n}${iso.slice(4, 10)}`;

/** The next 08:00 in Luxembourg after `now`, as an ISO instant; or now when outside quiet hours. */
function pushAfter(now: Date, severity: Severity): string {
  if (severity === "critical") return now.toISOString();
  const { hour } = luxParts(now);
  if (hour >= QUIET_TO && hour < QUIET_FROM) return now.toISOString();
  // Find the instant of the next 08:00 local by stepping from midnight UTC guesses.
  const target = new Date(now);
  for (let i = 0; i < 48; i++) {
    target.setUTCMinutes(0, 0, 0);
    target.setUTCHours(target.getUTCHours() + 1);
    const p = luxParts(target);
    if (p.hour === QUIET_TO) return target.toISOString();
  }
  return now.toISOString();
}

// ─── Portfolio words ────────────────────────────────────────────────────────

interface Names {
  unitOfLease: (leaseId: string) => string;
  tenantsOfLease: (leaseId: string) => string;
  unitOf: (unitId: string | null) => string;
  propertyOf: (propertyId: string | null) => string;
  contact: (id: string | null) => string;
}

async function names(g: SupabaseClient, orgId: string): Promise<Names> {
  const [{ data: units }, { data: properties }, { data: leases }, { data: parties }, { data: contacts }] = await Promise.all([
    g.from("units").select("id,property_id,label").eq("org_id", orgId),
    g.from("properties").select("id,name").eq("org_id", orgId),
    g.from("leases").select("id,unit_id").eq("org_id", orgId),
    g.from("lease_parties").select("lease_id,contact_id,role").eq("org_id", orgId),
    g.from("contacts").select("id,display_name,first_name,last_name,legal_name").eq("org_id", orgId),
  ]);
  const byId = (rows: Row[] | null) => new Map((rows ?? []).map((r) => [String(r.id), r]));
  const U = byId(units), P = byId(properties), L = byId(leases), C = byId(contacts);
  const contact = (id: string | null) => {
    const c = id ? C.get(id) : undefined;
    return String(c?.display_name || c?.legal_name || [c?.first_name, c?.last_name].filter(Boolean).join(" ") || "");
  };
  const unitOf = (unitId: string | null) => {
    const u = unitId ? U.get(unitId) : undefined;
    const p = u ? P.get(String(u.property_id)) : undefined;
    return u ? `${u.label}${p ? ` · ${p.name}` : ""}` : "";
  };
  return {
    contact,
    unitOf,
    propertyOf: (id) => String((id && P.get(id)?.name) || ""),
    unitOfLease: (leaseId) => unitOf(L.get(leaseId)?.unit_id ?? null),
    tenantsOfLease: (leaseId) => (parties ?? []).filter((p) => p.lease_id === leaseId && p.role === "tenant").map((p) => contact(p.contact_id)).filter(Boolean).join(", "),
  };
}

// ─── Enqueue and push ───────────────────────────────────────────────────────

async function enqueue(g: SupabaseClient, drafts: Draft[]): Promise<number> {
  if (drafts.length === 0) return 0;
  const now = new Date();
  const rows: Row[] = [];
  const recipientsByOrg = new Map<string, { user_id: string; lang: string }[]>();
  for (const d of drafts) {
    if (!recipientsByOrg.has(d.org_id)) {
      const { data } = await g.rpc("notify_recipients", { p_org: d.org_id });
      recipientsByOrg.set(d.org_id, (data ?? []) as { user_id: string; lang: string }[]);
    }
    const people = (recipientsByOrg.get(d.org_id) ?? []).filter((r) => !d.only || d.only.includes(r.user_id));
    if (people.length === 0) continue;
    const { data: prefs } = await g.from("notification_prefs").select("*").in("user_id", people.map((p) => p.user_id));
    const prefOf = new Map((prefs ?? []).map((p: Row) => [String(p.user_id), p]));
    const category = categoryOf(d.kind);
    const severity = d.severity ?? "normal";
    for (const person of people) {
      const pref = prefOf.get(person.user_id);
      if (pref && pref[category] === false) continue;
      const text = render(d.kind, person.lang, d.args);
      const quiet = pref ? pref.quiet_hours !== false : true;
      rows.push({
        user_id: person.user_id,
        org_id: d.org_id,
        kind: d.kind,
        category,
        severity,
        title: text.title,
        body: text.body,
        href: d.href ?? null,
        dedupe_key: d.dedupe_key,
        data: d.data ?? {},
        push_after: quiet ? pushAfter(now, severity) : now.toISOString(),
      });
    }
  }
  if (rows.length === 0) return 0;
  const { error } = await g.from("notifications").upsert(rows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
  if (error) console.error("enqueue failed", error.code, error.message);
  return rows.length;
}

async function flushPushes(g: SupabaseClient): Promise<number> {
  const nowIso = new Date().toISOString();
  const { data: pending } = await g.from("notifications").select("id,user_id,title,body,href,kind,severity,data").is("pushed_at", null).lte("push_after", nowIso).order("created_at").limit(300);
  if (!pending?.length) return 0;
  const userIds = [...new Set(pending.map((n: Row) => String(n.user_id)))];
  const [{ data: devices }, { data: unreadRows }] = await Promise.all([
    g.from("push_devices").select("id,user_id,token,platform").in("user_id", userIds).is("disabled_at", null),
    g.from("notifications").select("user_id").in("user_id", userIds).is("read_at", null),
  ]);
  const unread = new Map<string, number>();
  for (const r of unreadRows ?? []) unread.set(String(r.user_id), (unread.get(String(r.user_id)) ?? 0) + 1);
  const devicesOf = new Map<string, Row[]>();
  for (const d of devices ?? []) devicesOf.set(String(d.user_id), [...(devicesOf.get(String(d.user_id)) ?? []), d]);

  const messages: Row[] = [];
  const tokenDevice = new Map<string, string>();
  for (const n of pending as Row[]) {
    for (const d of devicesOf.get(String(n.user_id)) ?? []) {
      tokenDevice.set(String(d.token), String(d.id));
      messages.push({
        to: d.token,
        title: n.title,
        body: n.body,
        sound: "default",
        badge: unread.get(String(n.user_id)) ?? 0,
        priority: n.severity === "critical" || n.severity === "high" ? "high" : "default",
        interruptionLevel: n.severity === "critical" ? "time-sensitive" : "active",
        channelId: n.severity === "critical" ? "urgent" : "default",
        data: { id: n.id, href: n.href, kind: n.kind, ...(n.data ?? {}) },
      });
    }
  }
  const dead = new Set<string>();
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const res = await fetch(EXPO_PUSH, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", ...(Deno.env.get("EXPO_ACCESS_TOKEN") ? { Authorization: `Bearer ${Deno.env.get("EXPO_ACCESS_TOKEN")}` } : {}) }, body: JSON.stringify(chunk) });
      const json = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
      json.data?.forEach((ticket, idx) => {
        if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") dead.add(String(chunk[idx].to));
      });
    } catch (e) {
      console.error("expo push failed", e);
    }
  }
  if (dead.size) await g.from("push_devices").update({ disabled_at: nowIso }).in("id", [...dead].map((t) => tokenDevice.get(t)!).filter(Boolean));
  await g.from("notifications").update({ pushed_at: nowIso }).in("id", pending.map((n: Row) => n.id));
  return pending.length;
}

// ─── Events ─────────────────────────────────────────────────────────────────

async function handleEvent(g: SupabaseClient, body: { table: string; op: string; new: Row | null; old: Row | null }): Promise<number> {
  const row = body.new;
  if (!row || !row.org_id) return 0;
  const orgId = String(row.org_id);
  // The row's org_id is whatever the writer put there. Every object the row points at must belong
  // to that same org, read here with the service role; a row pointing across orgs is dropped, so a
  // write planted in another workspace never becomes that workspace's notification.
  const sameOrg = async (table: string, id: unknown): Promise<boolean> => {
    if (!id) return true;
    const { data } = await g.from(table).select("org_id").eq("id", String(id)).maybeSingle();
    return !!data && String(data.org_id) === orgId;
  };
  if (!(await sameOrg("leases", row.lease_id))) return 0;
  const N = await names(g, orgId);
  const { data: people } = await g.rpc("notify_recipients", { p_org: orgId });
  const lang = (people?.[0]?.lang as string) ?? "fr";
  const drafts: Draft[] = [];

  if (body.table === "payments" && body.op === "INSERT") {
    const leaseId = row.lease_id ? String(row.lease_id) : null;
    if (!leaseId) return 0;
    const { data: periods } = await g.from("rent_period_status").select("period,total_cents,allocated_cents,status").eq("org_id", orgId).eq("lease_id", leaseId).eq("period", `${luxParts().date.slice(0, 7)}-01`);
    const current = periods?.[0];
    const remaining = current ? Math.max(0, Number(current.total_cents) - Number(current.allocated_cents)) : 0;
    drafts.push({
      org_id: orgId,
      kind: "rent.received",
      args: { tenant: N.tenantsOfLease(leaseId), amount: euros(Number(row.amount_cents), lang), unit: N.unitOfLease(leaseId), remaining: remaining > 0 ? euros(remaining, lang) : "" },
      href: `/lease/${leaseId}`,
      dedupe_key: `payment:${row.id}`,
    });
  } else if (body.table === "messages" && body.op === "INSERT") {
    const { data: conv } = await g.from("conversations").select("id,scope_type,scope_id,subject").eq("org_id", orgId).eq("id", row.conversation_id).maybeSingle();
    if (!conv) return 0;
    const sender = N.contact(row.sender_contact_id) || (conv?.scope_type === "lease" && conv.scope_id ? N.tenantsOfLease(String(conv.scope_id)) : "") || String(conv?.subject ?? "");
    const unit = conv?.scope_type === "lease" && conv.scope_id ? N.unitOfLease(String(conv.scope_id)) : "";
    drafts.push({
      org_id: orgId,
      kind: "message.received",
      args: { sender: unit ? `${sender} · ${unit}` : sender, preview: String(row.body ?? "").replace(/\s+/g, " ").slice(0, 140) },
      href: `/messages/${row.conversation_id}`,
      dedupe_key: `message:${row.id}`,
    });
  } else if (body.table === "tickets" && body.op === "INSERT") {
    if (!(await sameOrg("units", row.unit_id)) || !(await sameOrg("properties", row.property_id))) return 0;
    const emergency = row.severity === "emergency";
    drafts.push({
      org_id: orgId,
      kind: "ticket.new",
      args: { unit: N.unitOf(row.unit_id) || N.propertyOf(row.property_id), title: String(row.title ?? ""), emergency: emergency ? "1" : "" },
      href: `/ticket/${row.id}`,
      dedupe_key: `ticket:${row.id}`,
      severity: emergency ? "critical" : row.severity === "urgent" ? "high" : "normal",
    });
  } else if (body.table === "portal_invites" && body.op === "UPDATE") {
    drafts.push({
      org_id: orgId,
      kind: "invite.accepted",
      args: { name: N.contact(row.contact_id), unit: row.lease_id ? N.unitOfLease(String(row.lease_id)) : "" },
      href: row.lease_id ? `/lease/${row.lease_id}` : "/messages",
      dedupe_key: `invite-accepted:${row.id}`,
    });
  } else if (body.table === "work_orders" && body.op === "UPDATE") {
    const { data: ticket } = await g.from("tickets").select("id,title,unit_id,property_id").eq("org_id", orgId).eq("id", row.ticket_id).maybeSingle();
    if (!ticket) return 0;
    const unit = ticket ? N.unitOf(ticket.unit_id) || N.propertyOf(ticket.property_id) : "";
    const artisan = N.contact(row.artisan_contact_id);
    if (row.status === "scheduled" && row.scheduled_at) {
      drafts.push({ org_id: orgId, kind: "work.scheduled", args: { unit, title: String(ticket?.title ?? ""), when: `${dateWords(String(row.scheduled_at), lang)} ${timeWords(String(row.scheduled_at), lang)}`, artisan }, href: `/ticket/${row.ticket_id}`, dedupe_key: `work-scheduled:${row.id}:${row.scheduled_at}` });
    } else if (row.status === "done") {
      drafts.push({ org_id: orgId, kind: "work.done", args: { unit, title: String(ticket?.title ?? ""), amount: row.amount_cents ? euros(Number(row.amount_cents), lang) : "", artisan }, href: `/ticket/${row.ticket_id}`, dedupe_key: `work-done:${row.id}` });
    }
  }
  return enqueue(g, drafts);
}

// ─── Reminders (daily, 08:00 Luxembourg) ────────────────────────────────────

async function reminders(g: SupabaseClient): Promise<number> {
  const { date: today, day, month, year } = luxParts();
  const month1 = `${today.slice(0, 7)}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const { data: orgRows } = await g.from("leases").select("org_id");
  const orgIds = [...new Set((orgRows ?? []).map((r: Row) => String(r.org_id)))];
  let total = 0;

  for (const orgId of orgIds) {
    const drafts: Draft[] = [];
    const { data: people } = await g.rpc("notify_recipients", { p_org: orgId });
    if (!people?.length) continue;
    const lang = String(people[0].lang ?? "fr");
    const N = await names(g, orgId);
    const [{ data: leases }, { data: rents }, { data: units }, { data: properties }, { data: notices }, { data: deadlines }, { data: insurances }, { data: tickets }, { data: works }, { data: banks }, { data: reviews }, { data: invites }, { data: deposits }] = await Promise.all([
      g.from("leases").select("id,unit_id,status,start_date,end_date,signed_at,created_at").eq("org_id", orgId),
      g.from("rent_period_status").select("id,lease_id,period,due_date,total_cents,allocated_cents,status").eq("org_id", orgId).gte("period", addDays(month1, -62)).lte("period", month1),
      g.from("units").select("id,property_id,archived_at").eq("org_id", orgId).is("archived_at", null),
      g.from("properties").select("id,name,cpe_issued_on,energy_class,smoke_detectors_confirmed,archived_at").eq("org_id", orgId).is("archived_at", null),
      g.from("notice_records").select("id,lease_id,earliest_lawful_end").eq("org_id", orgId).gte("earliest_lawful_end", today),
      g.from("legal_deadlines").select("id,kind,label,due_on,related_label,legal_basis,severity").eq("org_id", orgId).is("done_at", null).is("waived_at", null).gte("due_on", today).lte("due_on", addDays(today, 30)),
      g.from("insurance_policies").select("id,property_id,lease_id,kind,provider,expires_on").eq("org_id", orgId).gte("expires_on", today).lte("expires_on", addDays(today, 60)),
      g.from("tickets").select("id,title,unit_id,property_id,status,sla_due_at,pending_tenant_since").eq("org_id", orgId).not("status", "in", "(done,closed,cancelled)"),
      g.from("work_orders").select("id,ticket_id,artisan_contact_id,status,scheduled_at").eq("org_id", orgId).eq("status", "scheduled").gte("scheduled_at", `${today}T00:00:00Z`).lte("scheduled_at", `${today}T23:59:59Z`),
      g.from("bank_accounts").select("id,label,iban,provider,consent_expires_at,last_synced_at").eq("org_id", orgId).neq("provider", "manual"),
      g.from("bank_transactions").select("id").eq("org_id", orgId).eq("match_status", "review"),
      g.from("portal_invites").select("id,contact_id,lease_id,expires_at").eq("org_id", orgId).is("accepted_at", null).is("revoked_at", null).gte("expires_at", `${today}T00:00:00Z`).lte("expires_at", `${addDays(today, 2)}T23:59:59Z`),
      g.from("deposits").select("id,lease_id,received_on,status").eq("org_id", orgId).or("received_on.is.null,status.eq.pending"),
    ]);
    const live = (leases ?? []).filter((l: Row) => l.status === "active" || l.status === "notice");
    const leaseById = new Map((leases ?? []).map((l: Row) => [String(l.id), l]));
    const ticketById = new Map((tickets ?? []).map((t: Row) => [String(t.id), t]));

    // Rents late: day 1, 7, 15 and 30 of lateness, then every 30 days.
    for (const r of rents ?? []) {
      if (r.status !== "late" && r.status !== "partial_late") continue;
      const days = daysBetween(String(r.due_date), today);
      if (days < 1) continue;
      if (![1, 7, 15, 30].includes(days) && days % 30 !== 0) continue;
      const remaining = Number(r.total_cents) - Number(r.allocated_cents);
      drafts.push({ org_id: orgId, kind: "rent.late", args: { tenant: N.tenantsOfLease(String(r.lease_id)), amount: euros(remaining, lang), due: dateWords(String(r.due_date), lang), days: String(days), unit: N.unitOfLease(String(r.lease_id)) }, href: `/lease/${r.lease_id}`, dedupe_key: `rent-late:${r.id}:${days}`, severity: days >= 15 ? "high" : "normal" });
    }

    // Month summary on the 5th (after the usual payment days) and on the last day.
    if (day === 5 || day === lastDay) {
      const cur = (rents ?? []).filter((r: Row) => r.period === month1 && r.status !== "written_off");
      const expected = cur.reduce((a: number, r: Row) => a + Number(r.total_cents), 0);
      const collected = cur.reduce((a: number, r: Row) => a + Number(r.allocated_cents), 0);
      const late = cur.filter((r: Row) => r.status === "late" || r.status === "partial_late").length;
      const letUnits = new Set(live.map((l: Row) => String(l.unit_id)));
      const vacant = (units ?? []).filter((u: Row) => !letUnits.has(String(u.id))).length;
      if (cur.length > 0) drafts.push({ org_id: orgId, kind: "rent.month_summary", args: { month: monthWords(month1, lang), collected: euros(collected, lang), expected: euros(expected, lang), late: String(late), vacant: String(vacant) }, href: "/(tabs)/rents", dedupe_key: `month-summary:${month1}:${day === 5 ? "mid" : "end"}`, severity: "low" });
    }

    // Leases ending; notice periods; idle drafts; deposits before move-in.
    for (const l of leases ?? []) {
      const unit = N.unitOf(l.unit_id);
      const tenant = N.tenantsOfLease(String(l.id));
      if ((l.status === "active" || l.status === "notice") && l.end_date) {
        const days = daysBetween(today, String(l.end_date));
        if ([90, 30, 7].includes(days)) drafts.push({ org_id: orgId, kind: "lease.ending", args: { days: String(days), unit, tenant, date: dateWords(String(l.end_date), lang) }, href: `/lease/${l.id}`, dedupe_key: `lease-ending:${l.id}:${days}` });
      }
      if (l.status === "draft" && !l.signed_at) {
        const days = daysBetween(String(l.created_at).slice(0, 10), today);
        if (days === 7 || days === 30) drafts.push({ org_id: orgId, kind: "lease.draft_idle", args: { days: String(days), unit, tenant }, href: `/lease/${l.id}`, dedupe_key: `lease-draft:${l.id}:${days}`, severity: "low" });
      }
    }
    for (const n of notices ?? []) {
      const days = daysBetween(today, String(n.earliest_lawful_end));
      if ([30, 7].includes(days)) drafts.push({ org_id: orgId, kind: "lease.notice_end", args: { days: String(days), unit: N.unitOfLease(String(n.lease_id)), tenant: N.tenantsOfLease(String(n.lease_id)), date: dateWords(String(n.earliest_lawful_end), lang) }, href: `/lease/${n.lease_id}`, dedupe_key: `notice-end:${n.id}:${days}` });
    }
    for (const d of deposits ?? []) {
      const l = leaseById.get(String(d.lease_id));
      if (!l?.start_date || l.status === "ended") continue;
      const days = daysBetween(today, String(l.start_date));
      if (days === 7 || days === 0) drafts.push({ org_id: orgId, kind: "deposit.pending", args: { unit: N.unitOf(l.unit_id), tenant: N.tenantsOfLease(String(l.id)), date: dateWords(String(l.start_date), lang) }, href: `/lease/${l.id}`, dedupe_key: `deposit:${d.id}:${days}`, severity: "high" });
    }

    // Legal deadlines (indexation, decompte, syndic, tax) at 30, 7 and 0 days.
    for (const d of deadlines ?? []) {
      const days = daysBetween(today, String(d.due_on));
      if (![30, 7, 0].includes(days)) continue;
      drafts.push({ org_id: orgId, kind: "deadline.due", args: { days: String(days), label: String(d.label), related: String(d.related_label ?? ""), basis: String(d.legal_basis ?? ""), date: dateWords(String(d.due_on), lang) }, href: "/(tabs)/index", dedupe_key: `deadline:${d.id}:${days}`, severity: d.severity === "critical" || days === 0 ? "high" : "normal" });
    }

    // Insurance at 60, 30 and 7 days.
    for (const p of insurances ?? []) {
      const days = daysBetween(today, String(p.expires_on));
      if (![60, 30, 7].includes(days)) continue;
      const property = N.propertyOf(p.property_id) || (p.lease_id ? N.unitOfLease(String(p.lease_id)) : "");
      drafts.push({ org_id: orgId, kind: "insurance.expiring", args: { days: String(days), property, kind: String(p.kind ?? ""), provider: String(p.provider ?? ""), date: dateWords(String(p.expires_on), lang) }, href: p.property_id ? `/property/${p.property_id}` : "/(tabs)/properties", dedupe_key: `insurance:${p.id}:${days}` });
    }

    // Energy certificate (CPE, valid ten years) and smoke detectors, on let properties.
    const letProperties = new Set(live.map((l: Row) => String((units ?? []).find((u: Row) => u.id === l.unit_id)?.property_id ?? "")));
    const quarter = `${year}-Q${Math.ceil(month / 3)}`;
    for (const p of properties ?? []) {
      if (!letProperties.has(String(p.id))) continue;
      if (p.cpe_issued_on) {
        const expiry = addYears(String(p.cpe_issued_on), 10);
        const days = daysBetween(today, expiry);
        if ([180, 90, 30, 0].includes(days)) drafts.push({ org_id: orgId, kind: "energy.expiring", args: { days: String(days), property: String(p.name), issued: dateWords(String(p.cpe_issued_on), lang), expired: days <= 0 ? "1" : "" }, href: `/property/${p.id}`, dedupe_key: `cpe:${p.id}:${days}` });
        else if (days < 0 && day === 1) drafts.push({ org_id: orgId, kind: "energy.expiring", args: { days: "0", property: String(p.name), issued: dateWords(String(p.cpe_issued_on), lang), expired: "1" }, href: `/property/${p.id}`, dedupe_key: `cpe-expired:${p.id}:${quarter}` });
      } else if (!p.energy_class && day === 1) {
        drafts.push({ org_id: orgId, kind: "energy.missing", args: { property: String(p.name) }, href: `/property/${p.id}`, dedupe_key: `cpe-missing:${p.id}:${quarter}`, severity: "low" });
      }
      if (!p.smoke_detectors_confirmed && day === 1) drafts.push({ org_id: orgId, kind: "smoke.unconfirmed", args: { property: String(p.name) }, href: `/property/${p.id}`, dedupe_key: `smoke:${p.id}:${quarter}`, severity: "low" });
    }

    // Tickets: SLA passed, tenant silent for a week; work orders today.
    for (const t of tickets ?? []) {
      const unit = N.unitOf(t.unit_id) || N.propertyOf(t.property_id);
      if (t.sla_due_at && t.sla_due_at < new Date().toISOString() && t.status !== "pending_tenant") {
        const days = Math.max(1, daysBetween(String(t.sla_due_at).slice(0, 10), today));
        drafts.push({ org_id: orgId, kind: "ticket.sla", args: { unit, title: String(t.title), days: String(days) }, href: `/ticket/${t.id}`, dedupe_key: `sla:${t.id}:${today}`, severity: "high" });
      }
      if (t.status === "pending_tenant" && t.pending_tenant_since) {
        const days = daysBetween(String(t.pending_tenant_since).slice(0, 10), today);
        if (days === 7 || days === 14) drafts.push({ org_id: orgId, kind: "ticket.pending_tenant", args: { unit, title: String(t.title), days: String(days) }, href: `/ticket/${t.id}`, dedupe_key: `pending-tenant:${t.id}:${days}`, severity: "low" });
      }
    }
    for (const w of works ?? []) {
      const t = ticketById.get(String(w.ticket_id));
      drafts.push({ org_id: orgId, kind: "work.today", args: { time: timeWords(String(w.scheduled_at), lang), title: String(t?.title ?? ""), unit: t ? N.unitOf(t.unit_id) || N.propertyOf(t.property_id) : "", artisan: N.contact(w.artisan_contact_id) }, href: `/ticket/${w.ticket_id}`, dedupe_key: `work-today:${w.id}:${today}` });
    }

    // Bank: consent, stale sync, transfers to review.
    for (const b of banks ?? []) {
      const account = String(b.label || (b.iban ? `···${String(b.iban).slice(-4)}` : ""));
      if (b.consent_expires_at) {
        const days = daysBetween(today, String(b.consent_expires_at).slice(0, 10));
        if ([14, 3, 0].includes(days)) drafts.push({ org_id: orgId, kind: "bank.consent_expiring", args: { days: String(days), account }, href: "/finance", dedupe_key: `consent:${b.id}:${days}`, severity: days === 0 ? "high" : "normal" });
      }
      if (b.last_synced_at) {
        const days = daysBetween(String(b.last_synced_at).slice(0, 10), today);
        if (days >= 3 && days % 3 === 0) drafts.push({ org_id: orgId, kind: "bank.sync_stale", args: { days: String(days), account }, href: "/finance", dedupe_key: `sync-stale:${b.id}:${today}`, severity: "low" });
      }
    }
    if ((reviews ?? []).length > 0 && (day % 3 === 0)) drafts.push({ org_id: orgId, kind: "bank.review", args: { count: String(reviews!.length) }, href: "/finance", dedupe_key: `bank-review:${today}`, severity: "low" });

    // Invitations about to expire.
    for (const i of invites ?? []) {
      drafts.push({ org_id: orgId, kind: "invite.expiring", args: { name: N.contact(i.contact_id), unit: i.lease_id ? N.unitOfLease(String(i.lease_id)) : "", when: dateWords(String(i.expires_at), lang) }, href: i.lease_id ? `/lease/${i.lease_id}` : "/(tabs)/index", dedupe_key: `invite-expiring:${i.id}`, severity: "low" });
    }

    total += await enqueue(g, drafts);
  }

  // Trials started in the app: the open setup step on days one and three, and one reminder two days before the end.
  const { data: trials } = await g.rpc("notify_trials");
  const trialDrafts: Draft[] = [];
  for (const t of trials ?? []) {
    if (!t.org_id || !t.trial_started_at) continue;
    const ends = addDays(String(t.trial_started_at).slice(0, 10), 30);
    const days = daysBetween(today, ends);
    // One reminder, two days before the end: the day the paywall promises (TRIAL_REMINDER_BEFORE_DAYS in src/lib/access.ts).
    if (days === 2) trialDrafts.push({ org_id: String(t.org_id), kind: "trial.ending", args: { days: String(days) }, href: "/plans", dedupe_key: `trial:${t.user_id}:${days}`, only: [String(t.user_id)] });
    // A space that is still missing a step, one and three days in: the step that is open now, by name.
    // The order is the app's (src/lib/setup.ts): a lease needs a property, an invitation needs a lease.
    const since = daysBetween(String(t.trial_started_at).slice(0, 10), today);
    if (since === 1 || since === 3) {
      const org = String(t.org_id);
      const has = async (table: string, narrow?: "live" | "tenant") => {
        let q = g.from(table).select("id", { count: "exact", head: true }).eq("org_id", org);
        if (narrow === "live") q = q.is("archived_at", null);
        if (narrow === "tenant") q = q.eq("role", "tenant");
        const { count } = await q;
        return (count ?? 0) > 0;
      };
      // A count that cannot be read never holds back the other reminders: this one is simply not sent.
      try {
        const step = !(await has("properties", "live")) ? "property" : !(await has("leases")) ? "lease" : !(await has("bank_accounts")) ? "bank" : !(await has("portal_invites", "tenant")) ? "invite" : null;
        if (step) trialDrafts.push({ org_id: org, kind: "setup.next", args: { step }, href: "/setup-steps", dedupe_key: `setup:${t.user_id}:${since}`, only: [String(t.user_id)] });
      } catch (e) {
        console.error("setup.next", (e as Error).message);
      }
    }
  }
  total += await enqueue(g, trialDrafts);
  return total;
}

// ─── HTTP ───────────────────────────────────────────────────────────────────

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: Row;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const g = admin();
  const mode = String(body.mode ?? "");

  // The app, as the person: a test notification to themselves.
  if (mode === "test") {
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "unauthenticated" }, 401);
    const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
    const { data: me } = await asUser.auth.getUser(token);
    if (!me.user) return json({ error: "unauthenticated" }, 401);
    const orgId = String(body.org_id ?? "");
    if (!orgId) return json({ error: "no_org" }, 400);
    const { data: people } = await g.rpc("notify_recipients", { p_org: orgId });
    if (!(people ?? []).some((p: Row) => p.user_id === me.user!.id)) return json({ error: "forbidden" }, 403);
    await enqueue(g, [{ org_id: orgId, kind: "test", args: {}, href: "/notifications", dedupe_key: `test:${me.user.id}:${Date.now()}`, only: [me.user.id], severity: "critical" }]);
    const pushed = await flushPushes(g);
    return json({ ok: true, pushed });
  }

  // Everything else carries the shared secret.
  const { data: secret } = await g.rpc("notify_secret");
  if (!secret || req.headers.get("x-notify-secret") !== secret) return json({ error: "forbidden" }, 403);

  if (mode === "event") {
    const queued = await handleEvent(g, body as { table: string; op: string; new: Row | null; old: Row | null });
    const pushed = await flushPushes(g);
    return json({ ok: true, queued, pushed });
  }
  if (mode === "notify") {
    const queued = await enqueue(g, [{ org_id: String(body.org_id), kind: body.kind as Kind, args: body.args ?? {}, href: body.href, dedupe_key: String(body.dedupe_key ?? `${body.kind}:${Date.now()}`), severity: body.severity, only: body.only }]);
    const pushed = await flushPushes(g);
    return json({ ok: true, queued, pushed });
  }
  if (mode === "tick") {
    const { hour } = luxParts();
    const reminded = hour === QUIET_TO || body.force ? await reminders(g) : 0;
    const pushed = await flushPushes(g);
    return json({ ok: true, reminded, pushed });
  }
  return json({ error: "mode" }, 400);
});

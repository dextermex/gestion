import "server-only";
import type { OrgContext } from "@/lib/gestion/api";
import { leaseOfConversation, notifyTenantsOfMessage } from "@/lib/delivery/outbox";
import { appendMessage, leaseConversation } from "@/lib/portal/thread";
import { REQUEST_STATUSES, leaseSubject, requestStatusOf, type RequestStatus } from "@/lib/portal/types";
import { ticketForRequestStatus } from "@/lib/gestion/interventions";
import type { TicketStatus, WorkOrderStatus } from "@/lib/types";
import { THREAD_PAGE, latestMoment, type ThreadMessage } from "@/lib/gestion/threads";

/**
 * The desk's side of a tenant request: the same ticket row the tenant
 * raised, the same conversation both sides write on. Nothing here is a
 * copy. Every write runs under the manager's own token, scoped to the
 * active workspace by the code and decided by row-level security in the
 * database; an id from another workspace is simply not found.
 */

export type RequestWriteFailure = "invalid" | "not_found" | "forbidden" | "storage_failed";

/**
 * What became of the e-mail that tells the tenants a message waits in their
 * space: it left for at least one of them, it was due and left for none (no
 * mail key on the deployment, an address refused), or none was due (the
 * workspace switched it off, nobody to write to). The message itself is in
 * the tenant's space either way; the desk is told when the mail did not go.
 */
export type MailNotice = "sent" | "not_sent" | "none";

type Row = Record<string, unknown>;
type Db = OrgContext["g"];

function failure(error: { code?: string; message?: string } | null, context: string): { error: RequestWriteFailure } {
  if (error?.code === "42501") return { error: "forbidden" };
  console.error(`${context} failed:`, error?.code, error?.message);
  return { error: "storage_failed" };
}

export function parseRequestStatus(value: unknown): RequestStatus | null {
  return typeof value === "string" && (REQUEST_STATUSES as readonly string[]).includes(value) ? (value as RequestStatus) : null;
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** The request, if it is the workspace's. */
async function ownTicket(g: Db, orgId: string, ticketId: string): Promise<{ ticket: Row | null } | { error: RequestWriteFailure }> {
  const { data, error } = await g.from("tickets").select("id,title,status,lease_id,closed_at").eq("org_id", orgId).eq("id", ticketId).maybeSingle();
  if (error) return failure(error, "request lookup");
  return { ticket: (data as Row | null) ?? null };
}

/**
 * The owner's status on a request, from Messages. What it writes on the
 * ticket is decided with the ticket's work order in view
 * (`ticketForRequestStatus`), the same rules the Interventions steps follow:
 * resolving or refusing dates the closure once; choosing an open status on
 * a closed request is the explicit reopening; and a request whose
 * intervention is under way stays in progress, whatever was asked (`held`).
 * The answer is the status the request now has, read back from the row.
 */
export async function setRequestStatus(
  ctx: OrgContext,
  ticketId: string,
  status: RequestStatus,
): Promise<{ status: RequestStatus; held: boolean } | { error: RequestWriteFailure }> {
  const found = await ownTicket(ctx.g, ctx.org.id, ticketId);
  if ("error" in found) return found;
  if (!found.ticket) return { error: "not_found" };
  const { data: orders, error: orderErr } = await ctx.g.from("work_orders").select("id,status,created_at").eq("org_id", ctx.org.id).eq("ticket_id", ticketId).order("created_at").limit(1);
  if (orderErr) return failure(orderErr, "work order lookup");
  const workOrder = ((orders as Row[] | null) ?? [])[0];
  const next = ticketForRequestStatus(status, { status: String(found.ticket.status) as TicketStatus, workOrder: workOrder ? (String(workOrder.status) as WorkOrderStatus) : null });
  const now = new Date().toISOString();
  const closure = next.closure === "set" ? { closed_at: found.ticket.closed_at ?? now } : next.closure === "clear" ? { closed_at: null } : {};
  const { data, error } = await ctx.g
    .from("tickets")
    .update({ status: next.status, updated_at: now, ...closure })
    .eq("org_id", ctx.org.id)
    .eq("id", ticketId)
    .select("id");
  if (error) return failure(error, "request status update");
  // Nothing was written: the policies let this member read the request, not change it.
  if (((data as unknown[] | null) ?? []).length === 0) return { error: "forbidden" };
  return { status: requestStatusOf(next.status), held: next.held };
}

/** "Apt 3B · Résidence Beaulieu" for a lease of the workspace, or nothing if it cannot be read. */
async function subjectOfLease(g: Db, orgId: string, leaseId: string): Promise<string> {
  const { data: lease } = await g.from("leases").select("unit_id").eq("org_id", orgId).eq("id", leaseId).maybeSingle();
  const unitId = lease ? String((lease as Row).unit_id ?? "") : "";
  if (!unitId) return "";
  const { data: unit } = await g.from("units").select("label,property_id").eq("org_id", orgId).eq("id", unitId).maybeSingle();
  if (!unit) return "";
  const { data: property } = await g.from("properties").select("name").eq("org_id", orgId).eq("id", String((unit as Row).property_id ?? "")).maybeSingle();
  return leaseSubject(String((unit as Row).label ?? ""), property ? String((property as Row).name ?? "") : "");
}

/**
 * The conversation a request lives in: the one its anchor message sits on,
 * else the tenancy's own, opened here if nobody has written yet. A ticket
 * without a lease has no conversation to speak of.
 */
async function threadOf(g: Db, orgId: string, ticket: Row): Promise<{ id: string } | { error: RequestWriteFailure }> {
  const { data: anchors, error: anchorErr } = await g.from("messages").select("conversation_id").eq("org_id", orgId).eq("ticket_id", String(ticket.id)).limit(1);
  if (anchorErr) return failure(anchorErr, "request anchor lookup");
  const anchor = ((anchors as Array<{ conversation_id: string }> | null) ?? [])[0];
  if (anchor) return { id: String(anchor.conversation_id) };
  const leaseId = String(ticket.lease_id ?? "");
  if (!leaseId) return { error: "not_found" };
  return leaseConversation(g, { id: leaseId, orgId, subject: await subjectOfLease(g, orgId, leaseId) });
}

/**
 * A message from the desk, on a request's conversation or on any
 * conversation of the workspace. Written as the manager, in the manager's
 * name; the tenant reads it in their space on their next load.
 */
export async function addManagerMessage(
  ctx: OrgContext,
  target: { ticketId: string } | { conversationId: string } | { leaseId: string },
  body: unknown,
): Promise<{ id: string; conversationId: string; mail: MailNotice } | { error: RequestWriteFailure }> {
  const text = str(body, 4000);
  if (!text) return { error: "invalid" };

  let conversationId: string;
  // The tenancy the word is for: its tenants are told once it is written.
  let leaseId: string | null = null;
  if ("leaseId" in target) {
    // The tenancy's conversation, opened by the desk if nobody has written yet.
    const { data: lease, error } = await ctx.g.from("leases").select("id").eq("org_id", ctx.org.id).eq("id", target.leaseId).maybeSingle();
    if (error) return failure(error, "lease lookup");
    if (!lease) return { error: "not_found" };
    const thread = await leaseConversation(ctx.g, { id: target.leaseId, orgId: ctx.org.id, subject: await subjectOfLease(ctx.g, ctx.org.id, target.leaseId) });
    if ("error" in thread) return thread;
    conversationId = thread.id;
    leaseId = target.leaseId;
  } else if ("ticketId" in target) {
    const found = await ownTicket(ctx.g, ctx.org.id, target.ticketId);
    if ("error" in found) return found;
    if (!found.ticket) return { error: "not_found" };
    const thread = await threadOf(ctx.g, ctx.org.id, found.ticket);
    if ("error" in thread) return thread;
    conversationId = thread.id;
    leaseId = found.ticket.lease_id ? String(found.ticket.lease_id) : null;
  } else {
    const { data, error } = await ctx.g.from("conversations").select("id").eq("org_id", ctx.org.id).eq("id", target.conversationId).maybeSingle();
    if (error) return failure(error, "conversation lookup");
    if (!data) return { error: "not_found" };
    conversationId = String((data as Row).id);
    leaseId = await leaseOfConversation(ctx, conversationId);
  }

  const sent = await appendMessage(ctx.g, { orgId: ctx.org.id, conversationId, senderKind: "manager", senderUserId: ctx.userId, body: text, touch: true });
  if ("error" in sent) return sent;
  // A reply on a request also counts as activity on it.
  if ("ticketId" in target) await ctx.g.from("tickets").update({ updated_at: sent.sentAt }).eq("org_id", ctx.org.id).eq("id", target.ticketId);
  // The tenants are told by e-mail when the workspace wants it; the word stands whatever becomes of the mail.
  const outcomes = leaseId ? await notifyTenantsOfMessage(ctx, { leaseId, text }) : [];
  const mail: MailNotice = outcomes.length === 0 ? "none" : outcomes.some((o) => o.status === "sent") ? "sent" : "not_sent";
  return { id: sent.id, conversationId, mail };
}

const SENDER_KINDS: readonly ThreadMessage["kind"][] = ["tenant", "manager", "owner", "artisan", "system"];

/**
 * One conversation of the workspace, read for the screen: its newest
 * messages in the order they were written, each under the name the list
 * shows (the contact's, else the workspace's for the desk). `before` asks
 * for the page that precedes a moment; `earlier` says whether one exists.
 * The same rows, names and order the page's own loader gives the
 * conversation it opens on.
 */
export async function readConversation(
  ctx: OrgContext,
  conversationId: string,
  opts: { before?: string | null; limit?: number } = {},
): Promise<{ messages: ThreadMessage[]; earlier: boolean } | { error: RequestWriteFailure }> {
  const { g, org } = ctx;
  const { data: found, error: findErr } = await g.from("conversations").select("id").eq("org_id", org.id).eq("id", conversationId).maybeSingle();
  if (findErr) return failure(findErr, "conversation lookup");
  if (!found) return { error: "not_found" };

  const limit = Math.max(1, Math.min(opts.limit ?? THREAD_PAGE, THREAD_PAGE));
  let query = g.from("messages").select("id,sender_kind,sender_contact_id,sender_user_id,body,sent_at,ticket_id").eq("org_id", org.id).eq("conversation_id", conversationId);
  if (opts.before) query = query.lt("sent_at", opts.before);
  // One more than the page: its presence says there is an earlier page.
  const { data, error } = await query.order("sent_at", { ascending: false }).limit(limit + 1);
  if (error) return failure(error, "conversation read");
  const rows = ((data as Row[] | null) ?? []).slice();
  const earlier = rows.length > limit;
  const page = rows.slice(0, limit).reverse();

  const ids = (key: string): string[] => [...new Set(page.map((m) => (typeof m[key] === "string" ? (m[key] as string) : "")).filter(Boolean))];
  const contactIds = ids("sender_contact_id");
  const userIds = ids("sender_user_id");
  const CONTACT = "id,display_name,legal_name,first_name,last_name,user_id";
  const [byId, byUser] = await Promise.all([
    contactIds.length > 0 ? g.from("contacts").select(CONTACT).eq("org_id", org.id).is("archived_at", null).in("id", contactIds) : Promise.resolve({ data: [] as Row[], error: null }),
    userIds.length > 0 ? g.from("contacts").select(CONTACT).eq("org_id", org.id).is("archived_at", null).in("user_id", userIds) : Promise.resolve({ data: [] as Row[], error: null }),
  ]);
  if (byId.error) console.error("conversation sender lookup failed:", byId.error.code, byId.error.message);
  if (byUser.error) console.error("conversation sender lookup failed:", byUser.error.code, byUser.error.message);
  const nameOf = (c: Row): string => String(c.display_name || c.legal_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || "");
  const nameById = new Map(((byId.data as Row[] | null) ?? []).map((c) => [String(c.id), nameOf(c)]));
  const nameByUser = new Map(((byUser.data as Row[] | null) ?? []).map((c) => [String(c.user_id), nameOf(c)]));

  return {
    earlier,
    messages: page.map((m) => {
      const kind = (SENDER_KINDS as readonly string[]).includes(String(m.sender_kind)) ? (String(m.sender_kind) as ThreadMessage["kind"]) : "system";
      const from = nameById.get(String(m.sender_contact_id ?? "")) || nameByUser.get(String(m.sender_user_id ?? "")) || (m.sender_kind === "manager" ? org.name : "Système");
      return { id: String(m.id), from, kind, body: String(m.body ?? ""), at: String(m.sent_at ?? ""), ticketId: m.ticket_id ? String(m.ticket_id) : null };
    }),
  };
}

/**
 * A conversation is on the desk's screen: what the other side wrote is now
 * read, for every member and on every device (the mark is on the messages).
 * `until` is the moment of the last message the screen shows: one that
 * arrived since stays unread until it is shown too. Unrelated to any
 * request's status.
 */
export async function markConversationRead(ctx: OrgContext, conversationId: string, until: string | null = null): Promise<{ marked: number } | { error: RequestWriteFailure }> {
  let query = ctx.g
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("org_id", ctx.org.id)
    .eq("conversation_id", conversationId)
    .is("read_at", null)
    .in("sender_kind", ["tenant", "owner", "artisan", "system"]);
  if (until) query = query.lte("sent_at", until);
  const { data, error } = await query.select("id");
  if (error) return failure(error, "conversation read mark");
  return { marked: ((data as unknown[] | null) ?? []).length };
}

/**
 * What waits to be read at the desk and when anything was last written,
 * over the workspace's conversations: the heads view, three columns. The
 * figures the shell's badge and the list are drawn from. Null when the read
 * fails: the caller then says nothing rather than something wrong.
 */
export async function deskUnread(ctx: OrgContext): Promise<{ unread: number; latest: string } | null> {
  const { data, error } = await ctx.g.from("conversation_heads").select("conversation_id,unread,last_sent_at").eq("org_id", ctx.org.id).limit(2000);
  if (error) {
    console.error("conversation heads read failed:", error.code, error.message);
    return null;
  }
  const rows = (data as Row[] | null) ?? [];
  return { unread: rows.reduce((total, r) => total + (Number(r.unread) || 0), 0), latest: latestMoment(rows.map((r) => (typeof r.last_sent_at === "string" ? r.last_sent_at : ""))) };
}

/**
 * A request becomes an intervention when the owner decides physical work
 * is needed: a work order on the same ticket, so the request, its place in
 * the conversation and its photos stay where they are and the Interventions
 * screen lists it. Asked twice, it answers with the same work order.
 */
export async function createIntervention(ctx: OrgContext, ticketId: string): Promise<{ id: string; created: boolean } | { error: RequestWriteFailure }> {
  const found = await ownTicket(ctx.g, ctx.org.id, ticketId);
  if ("error" in found) return found;
  if (!found.ticket) return { error: "not_found" };
  const { data: existing, error: findErr } = await ctx.g.from("work_orders").select("id").eq("org_id", ctx.org.id).eq("ticket_id", ticketId).limit(1);
  if (findErr) return failure(findErr, "work order lookup");
  const current = ((existing as Array<{ id: string }> | null) ?? [])[0];
  if (current) return { id: String(current.id), created: false };
  const { data, error } = await ctx.g.from("work_orders").insert({ org_id: ctx.org.id, ticket_id: ticketId, status: "offered" }).select("id").single();
  if (error || !data) return failure(error, "work order insert");
  await ctx.g.from("tickets").update({ updated_at: new Date().toISOString() }).eq("org_id", ctx.org.id).eq("id", ticketId);
  return { id: String((data as Row).id), created: true };
}

/** The HTTP status a write failure answers with. */
export function statusOfFailure(error: RequestWriteFailure): number {
  return error === "invalid" ? 400 : error === "not_found" ? 404 : error === "forbidden" ? 403 : 502;
}

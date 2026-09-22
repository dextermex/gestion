import "server-only";
import type { OrgContext } from "@/lib/gestion/api";
import { appendMessage, leaseConversation } from "@/lib/portal/thread";
import { REQUEST_STATUSES, leaseSubject, ticketStatusFor, type RequestStatus } from "@/lib/portal/types";

/**
 * The desk's side of a tenant request: the same ticket row the tenant
 * raised, the same conversation both sides write on. Nothing here is a
 * copy. Every write runs under the manager's own token, scoped to the
 * active workspace by the code and decided by row-level security in the
 * database; an id from another workspace is simply not found.
 */

export type RequestWriteFailure = "invalid" | "not_found" | "forbidden" | "storage_failed";

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
  const { data, error } = await g.from("tickets").select("id,title,status,lease_id").eq("org_id", orgId).eq("id", ticketId).maybeSingle();
  if (error) return failure(error, "request lookup");
  return { ticket: (data as Row | null) ?? null };
}

/**
 * The owner's status on a request. The four statuses map onto the
 * intervention system's own; resolving or refusing also dates the closure,
 * reopening clears it.
 */
export async function setRequestStatus(
  ctx: OrgContext,
  ticketId: string,
  status: RequestStatus,
): Promise<{ status: RequestStatus } | { error: RequestWriteFailure }> {
  const found = await ownTicket(ctx.g, ctx.org.id, ticketId);
  if ("error" in found) return found;
  if (!found.ticket) return { error: "not_found" };
  const now = new Date().toISOString();
  const closed = status === "resolved" || status === "refused";
  const { error } = await ctx.g
    .from("tickets")
    .update({ status: ticketStatusFor(status), updated_at: now, closed_at: closed ? now : null })
    .eq("org_id", ctx.org.id)
    .eq("id", ticketId);
  if (error) return failure(error, "request status update");
  return { status };
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
): Promise<{ id: string; conversationId: string } | { error: RequestWriteFailure }> {
  const text = str(body, 4000);
  if (!text) return { error: "invalid" };

  let conversationId: string;
  if ("leaseId" in target) {
    // The tenancy's conversation, opened by the desk if nobody has written yet.
    const { data: lease, error } = await ctx.g.from("leases").select("id").eq("org_id", ctx.org.id).eq("id", target.leaseId).maybeSingle();
    if (error) return failure(error, "lease lookup");
    if (!lease) return { error: "not_found" };
    const thread = await leaseConversation(ctx.g, { id: target.leaseId, orgId: ctx.org.id, subject: await subjectOfLease(ctx.g, ctx.org.id, target.leaseId) });
    if ("error" in thread) return thread;
    conversationId = thread.id;
  } else if ("ticketId" in target) {
    const found = await ownTicket(ctx.g, ctx.org.id, target.ticketId);
    if ("error" in found) return found;
    if (!found.ticket) return { error: "not_found" };
    const thread = await threadOf(ctx.g, ctx.org.id, found.ticket);
    if ("error" in thread) return thread;
    conversationId = thread.id;
  } else {
    const { data, error } = await ctx.g.from("conversations").select("id").eq("org_id", ctx.org.id).eq("id", target.conversationId).maybeSingle();
    if (error) return failure(error, "conversation lookup");
    if (!data) return { error: "not_found" };
    conversationId = String((data as Row).id);
  }

  const sent = await appendMessage(ctx.g, { orgId: ctx.org.id, conversationId, senderKind: "manager", senderUserId: ctx.userId, body: text, touch: true });
  if ("error" in sent) return sent;
  // A reply on a request also counts as activity on it.
  if ("ticketId" in target) await ctx.g.from("tickets").update({ updated_at: sent.sentAt }).eq("org_id", ctx.org.id).eq("id", target.ticketId);
  return { id: sent.id, conversationId };
}

/** Opening a conversation at the desk: what the other side wrote is now read. Unrelated to any request's status. */
export async function markConversationRead(ctx: OrgContext, conversationId: string): Promise<{ marked: number } | { error: RequestWriteFailure }> {
  const { data, error } = await ctx.g
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("org_id", ctx.org.id)
    .eq("conversation_id", conversationId)
    .is("read_at", null)
    .in("sender_kind", ["tenant", "owner", "artisan", "system"])
    .select("id");
  if (error) return failure(error, "conversation read mark");
  return { marked: ((data as unknown[] | null) ?? []).length };
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

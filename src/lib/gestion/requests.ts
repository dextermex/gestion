import "server-only";
import type { OrgContext } from "@/lib/gestion/api";
import { REQUEST_STATUSES, ticketStatusFor, type RequestStatus } from "@/lib/portal/types";

/**
 * The desk's side of a tenant request: the same ticket row the tenant
 * raised, the same thread they read. Nothing here is a copy. Every write
 * runs under the manager's own token, scoped to the active workspace by
 * the code and decided by row-level security in the database; an id from
 * another workspace is simply not found.
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

/** The request's thread, opened on first use if the tenant's side has not already. */
async function threadOf(g: Db, orgId: string, ticket: { id: string; title: string }): Promise<{ id: string } | { error: RequestWriteFailure }> {
  const { data: existing, error: findErr } = await g
    .from("conversations")
    .select("id")
    .eq("org_id", orgId)
    .eq("scope_type", "ticket")
    .eq("scope_id", ticket.id)
    .limit(1);
  if (findErr) return failure(findErr, "request thread lookup");
  const found = ((existing as Array<{ id: string }> | null) ?? [])[0];
  if (found) return { id: String(found.id) };
  const { data: created, error: createErr } = await g
    .from("conversations")
    .insert({ org_id: orgId, scope_type: "ticket", scope_id: ticket.id, subject: ticket.title })
    .select("id")
    .single();
  if (createErr || !created) return failure(createErr, "request thread insert");
  return { id: String((created as Row).id) };
}

/**
 * A reply from the desk, on a request's thread or on any conversation of
 * the workspace. Written as the manager, in the manager's name; the tenant
 * reads it in their space on their next load.
 */
export async function addManagerMessage(
  ctx: OrgContext,
  target: { ticketId: string } | { conversationId: string },
  body: unknown,
): Promise<{ id: string; conversationId: string } | { error: RequestWriteFailure }> {
  const text = str(body, 4000);
  if (!text) return { error: "invalid" };

  let conversationId: string;
  if ("ticketId" in target) {
    const found = await ownTicket(ctx.g, ctx.org.id, target.ticketId);
    if ("error" in found) return found;
    if (!found.ticket) return { error: "not_found" };
    const thread = await threadOf(ctx.g, ctx.org.id, { id: String(found.ticket.id), title: String(found.ticket.title ?? "") });
    if ("error" in thread) return thread;
    conversationId = thread.id;
  } else {
    const { data, error } = await ctx.g.from("conversations").select("id").eq("org_id", ctx.org.id).eq("id", target.conversationId).maybeSingle();
    if (error) return failure(error, "conversation lookup");
    if (!data) return { error: "not_found" };
    conversationId = String((data as Row).id);
  }

  const now = new Date().toISOString();
  const { data: message, error } = await ctx.g
    .from("messages")
    .insert({ org_id: ctx.org.id, conversation_id: conversationId, sender_kind: "manager", sender_user_id: ctx.userId, body: text, sent_at: now })
    .select("id")
    .single();
  if (error || !message) return failure(error, "manager message insert");
  // The thread's own clock; a request also counts a reply as activity.
  await ctx.g.from("conversations").update({ last_message_at: now }).eq("org_id", ctx.org.id).eq("id", conversationId);
  if ("ticketId" in target) await ctx.g.from("tickets").update({ updated_at: now }).eq("org_id", ctx.org.id).eq("id", target.ticketId);
  return { id: String((message as Row).id), conversationId };
}

/** Opening a thread at the desk: what the other side wrote is now read. Unrelated to the request's status. */
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
 * is needed: a work order on the same ticket, so the request, its thread
 * and its photos stay where they are and the Interventions screen lists
 * it. Asked twice, it answers with the same work order.
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

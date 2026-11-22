import "server-only";
import type { GestionReader } from "@/lib/demo/data-real";
import { latestMoment } from "@/lib/gestion/threads";

/**
 * One conversation per tenancy, on both sides of the portal. The tenant's
 * space and the desk's Messages read the same `conversations` row, scoped
 * to the lease; a tenant request is a message on it that carries the
 * ticket. Whoever writes first opens it; a race is settled by the unique
 * index on the lease, and the loser reads the winner's row.
 */

type Row = Record<string, unknown>;
export type ThreadFailure = "forbidden" | "storage_failed";

function failure(error: { code?: string; message?: string } | null, context: string): { error: ThreadFailure } {
  if (error?.code === "42501") return { error: "forbidden" };
  console.error(`${context} failed:`, error?.code, error?.message);
  return { error: "storage_failed" };
}

/** The tenancy's conversation, found or opened. */
export async function leaseConversation(
  g: GestionReader,
  lease: { id: string; orgId: string; subject: string },
): Promise<{ id: string; created: boolean } | { error: ThreadFailure }> {
  const find = async (): Promise<{ id: string } | { error: ThreadFailure } | null> => {
    const { data, error } = await g.from("conversations").select("id").eq("scope_type", "lease").eq("scope_id", lease.id).limit(1);
    if (error) return failure(error, "lease conversation lookup");
    const row = ((data as Array<{ id: string }> | null) ?? [])[0];
    return row ? { id: String(row.id) } : null;
  };
  const found = await find();
  if (found && "error" in found) return found;
  if (found) return { id: found.id, created: false };

  const { data, error } = await g
    .from("conversations")
    .insert({ org_id: lease.orgId, scope_type: "lease", scope_id: lease.id, subject: lease.subject || "Conversation" })
    .select("id")
    .single();
  if (!error && data) return { id: String((data as Row).id), created: true };
  if (error?.code === "23505") {
    // Opened meanwhile by the other side: theirs is the one. If it still
    // cannot be read, it is not the caller's tenancy.
    const again = await find();
    if (again && "error" in again) return again;
    if (again) return { id: again.id, created: false };
    return { error: "forbidden" };
  }
  return failure(error, "lease conversation insert");
}

/**
 * A message on a conversation, in the writer's name. A request's anchor
 * carries its ticket; the clock is set here so the thread's own clock can
 * agree with it. Only the desk may touch the thread's clock: the tenant's
 * writes leave it to the messages themselves.
 */
export async function appendMessage(
  g: GestionReader,
  input: {
    orgId: string;
    conversationId: string;
    senderKind: "manager" | "tenant";
    senderUserId: string;
    body: string;
    ticketId?: string | null;
    touch: boolean;
    /** The id the writing screen chose: sent again (a retry, an answer that never came), the message is kept once. */
    clientId?: string | null;
  },
): Promise<{ id: string; sentAt: string; repeated?: boolean } | { error: ThreadFailure }> {
  const now = new Date().toISOString();
  // The anchor column (0019) is named only when a ticket is anchored, so a
  // plain message still goes through on a database that lacks it.
  const row: Record<string, unknown> = {
    org_id: input.orgId,
    conversation_id: input.conversationId,
    sender_kind: input.senderKind,
    sender_user_id: input.senderUserId,
    body: input.body,
    sent_at: now,
  };
  if (input.ticketId) row.ticket_id = input.ticketId;
  if (input.clientId) row.id = input.clientId;
  const { data, error } = await g.from("messages").insert(row).select("id").single();
  if (error?.code === "23505" && input.clientId) {
    // Already written by an earlier send of the same draft: that one stands, nothing is written twice.
    const { data: kept } = await g.from("messages").select("id,sent_at,conversation_id,sender_user_id").eq("id", input.clientId).maybeSingle();
    const k = (kept as Row | null) ?? null;
    if (k && String(k.conversation_id) === input.conversationId && String(k.sender_user_id) === input.senderUserId) {
      return { id: String(k.id), sentAt: String(k.sent_at ?? now), repeated: true };
    }
    return { error: "forbidden" };
  }
  if (error || !data) return failure(error, `${input.senderKind} message insert`);
  if (input.touch) await g.from("conversations").update({ last_message_at: now }).eq("id", input.conversationId);
  return { id: String((data as Row).id), sentAt: now };
}

/**
 * The tenant read a conversation up to a moment (the last message their
 * screen shows). The database decides: the conversation must be one of the
 * caller's tenancies, and the mark never passes the last message written
 * nor moves back (`gestion.mark_conversation_read`, 0031).
 */
export async function markTenantRead(
  g: Pick<GestionReader, "rpc">,
  conversationId: string,
  until: string | null,
): Promise<{ readUntil: string | null } | { error: ThreadFailure | "schema_outdated" }> {
  const { data, error } = await g.rpc("mark_conversation_read", { p_conversation: conversationId, p_until: until });
  if (error) {
    // The function arrives with 0031: until then nothing is marked, and nothing is broken.
    if (error.code === "PGRST202" || error.code === "42883") return { error: "schema_outdated" };
    return failure(error, "tenant read mark");
  }
  return { readUntil: typeof data === "string" ? data : null };
}

/**
 * What the tenant has not read, and when anything was last written, over
 * their conversations: one light read, for the navigation's count and for
 * the space asking now and then whether something arrived. Null when the
 * base does not carry the function yet.
 */
export async function tenantUnread(g: Pick<GestionReader, "rpc">): Promise<{ unread: number; latest: string } | null> {
  const { data, error } = await g.rpc("my_unread_messages");
  if (error) {
    if (error.code !== "PGRST202" && error.code !== "42883") console.error("tenant unread read failed:", error.code, error.message);
    return null;
  }
  const rows = (data as Row[] | null) ?? [];
  return { unread: rows.reduce((total, r) => total + (Number(r.unread) || 0), 0), latest: latestMoment(rows.map((r) => (typeof r.last_sent_at === "string" ? r.last_sent_at : ""))) };
}

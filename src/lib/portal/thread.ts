import "server-only";
import type { GestionReader } from "@/lib/demo/data-real";

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
  input: { orgId: string; conversationId: string; senderKind: "manager" | "tenant"; senderUserId: string; body: string; ticketId?: string | null; touch: boolean },
): Promise<{ id: string; sentAt: string } | { error: ThreadFailure }> {
  const now = new Date().toISOString();
  const { data, error } = await g
    .from("messages")
    .insert({
      org_id: input.orgId,
      conversation_id: input.conversationId,
      sender_kind: input.senderKind,
      sender_user_id: input.senderUserId,
      body: input.body,
      sent_at: now,
      ticket_id: input.ticketId ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return failure(error, `${input.senderKind} message insert`);
  if (input.touch) await g.from("conversations").update({ last_message_at: now }).eq("id", input.conversationId);
  return { id: String((data as Row).id), sentAt: now };
}

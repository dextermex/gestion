import "server-only";
import { notifyManagerFromTenant } from "@/lib/delivery/outbox";
import type { GestionReader } from "@/lib/demo/data-real";
import { appendMessage, leaseConversation } from "@/lib/portal/thread";
import { REQUEST_KINDS, attachmentFolder, ticketCategoryFor, type RequestKind } from "@/lib/portal/types";

/**
 * A tenant's request is a ticket, the same row the owner's screens track,
 * written under the tenant's own token: the database's insert policy
 * decides that the lease is theirs and in force. A technical problem lands
 * in its category; a document request, a question or anything else is an
 * administrative ticket tagged by kind. Photos are documents of the ticket,
 * in the lease's own storage folder. The request then takes its place in
 * the tenancy's conversation as a message that carries the ticket, so both
 * sides read it where they talk.
 */

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export interface NewRequestInput {
  kind: RequestKind;
  category: string | null;
  title: string;
  description: string;
  severity: "routine" | "priority" | "urgent";
}

/** The tenancy a request or a message lands on, as `my_home()` describes it. */
export interface TenantLeaseRef {
  id: string;
  orgId: string;
  /** "Apt 3B · Résidence Beaulieu": the conversation's subject when it is opened. */
  subject: string;
}

export function parseRequestInput(body: Record<string, unknown>): NewRequestInput | null {
  const kind = (REQUEST_KINDS as readonly string[]).includes(str(body.kind, 20)) ? (str(body.kind, 20) as RequestKind) : null;
  const title = str(body.title, 200);
  const description = str(body.description, 4000);
  if (!kind || !title) return null;
  const severity = ["routine", "priority", "urgent"].includes(str(body.severity, 10)) ? (str(body.severity, 10) as NewRequestInput["severity"]) : "routine";
  return { kind, category: str(body.category, 40) || null, title, description, severity };
}

export type RequestFailure = "invalid" | "forbidden" | "storage_failed";

function failure(error: { code?: string; message?: string } | null, context: string): { error: RequestFailure } {
  if (error?.code === "42501") return { error: "forbidden" };
  console.error(`${context} failed:`, error?.code, error?.message);
  return { error: "storage_failed" };
}

export async function createTenantRequest(
  g: GestionReader,
  user: { id: string },
  lease: TenantLeaseRef & { unitId: string; propertyId: string },
  input: NewRequestInput,
): Promise<{ id: string; conversationId: string | null } | { error: RequestFailure }> {
  const description = input.kind === "technical" ? input.description : `[${input.kind}] ${input.description}`.trim();
  const { data, error } = await g
    .from("tickets")
    .insert({
      org_id: lease.orgId,
      unit_id: lease.unitId,
      property_id: lease.propertyId,
      lease_id: lease.id,
      source: "tenant",
      category: ticketCategoryFor(input.kind, input.category),
      severity: input.severity,
      status: "new",
      title: input.title,
      description: description || null,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return failure(error, "tenant request insert");
  const id = String(data.id);
  // The request takes its place in the tenancy's conversation at once. If
  // that fails the request still stands: the desk's first reply anchors it.
  const thread = await leaseConversation(g, lease);
  if ("error" in thread) {
    console.error("tenant request thread failed:", thread.error);
    return { id, conversationId: null };
  }
  const anchor = await appendMessage(g, { orgId: lease.orgId, conversationId: thread.id, senderKind: "tenant", senderUserId: user.id, body: input.title, ticketId: id, touch: false });
  if ("error" in anchor) console.error("tenant request anchor failed:", anchor.error);
  // The desk is told by e-mail when the workspace wants it; the request stands whatever becomes of the mail.
  await notifyManagerFromTenant(g, { id: lease.id, subject: lease.subject }, { kind: "request", text: description, title: input.title, ticketId: id });
  return { id, conversationId: thread.id };
}

export interface UploadedFile {
  path: string;
  name: string;
  mime: string;
  sizeBytes: number;
}

/** Records photos already uploaded to the lease's folder; a path outside that folder is refused. */
export async function attachTenantFiles(
  g: GestionReader,
  user: { id: string },
  lease: { id: string; orgId: string },
  ticketId: string,
  files: UploadedFile[],
): Promise<{ attached: number } | { error: RequestFailure }> {
  const folder = attachmentFolder(lease.orgId, lease.id);
  const rows = files
    .filter((f) => f.path.startsWith(folder) && !f.path.includes("..") && f.path.length < 300)
    .slice(0, 10)
    .map((f) => ({
      org_id: lease.orgId,
      class: "photo",
      retention_class: "gdpr_minimised",
      name: str(f.name, 160) || "photo",
      storage_path: f.path,
      mime: str(f.mime, 80) || null,
      size_bytes: Number.isFinite(f.sizeBytes) ? Math.max(0, Math.round(f.sizeBytes)) : null,
      related_type: "ticket",
      related_id: ticketId,
      uploaded_by: user.id,
    }));
  if (rows.length === 0) return { attached: 0 };
  const { data, error } = await g.from("documents").insert(rows).select("id");
  if (error) return failure(error, "tenant attachment insert");
  return { attached: (data as unknown[] | null)?.length ?? rows.length };
}

/** A message from the tenant in the tenancy's conversation, opened on first use. */
export async function addTenantMessage(
  g: GestionReader,
  user: { id: string },
  lease: TenantLeaseRef,
  body: string,
): Promise<{ id: string; conversationId: string } | { error: RequestFailure }> {
  const text = str(body, 4000);
  if (!text) return { error: "invalid" };
  const thread = await leaseConversation(g, lease);
  if ("error" in thread) return thread;
  const sent = await appendMessage(g, { orgId: lease.orgId, conversationId: thread.id, senderKind: "tenant", senderUserId: user.id, body: text, touch: false });
  if ("error" in sent) return sent;
  await notifyManagerFromTenant(g, { id: lease.id, subject: lease.subject }, { kind: "message", text });
  return { id: sent.id, conversationId: thread.id };
}

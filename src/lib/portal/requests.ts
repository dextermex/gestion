import "server-only";
import type { GestionReader } from "@/lib/demo/data-real";
import { REQUEST_KINDS, attachmentFolder, ticketCategoryFor, type RequestKind } from "@/lib/portal/types";

/**
 * A tenant's request is an intervention, the same row the owner's screens
 * list under Interventions, written under the tenant's own token: the
 * database's insert policy decides that the lease is theirs and in force.
 * A technical problem lands in its category; a document request, a question
 * or anything else is an administrative intervention tagged by kind. Photos
 * are documents of the ticket, in the lease's own storage folder; a follow-
 * up is a message on the ticket's conversation.
 */

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export interface NewRequestInput {
  kind: RequestKind;
  category: string | null;
  title: string;
  description: string;
  severity: "routine" | "priority" | "urgent";
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
  lease: { id: string; orgId: string; unitId: string; propertyId: string },
  input: NewRequestInput,
): Promise<{ id: string } | { error: RequestFailure }> {
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
  // The request's thread opens with it, so the desk lists it under
  // Messages at once. If this insert fails the request still stands: the
  // thread is opened on first message instead.
  const { error: threadErr } = await g.from("conversations").insert({ org_id: lease.orgId, scope_type: "ticket", scope_id: id, subject: input.title });
  if (threadErr) console.error("tenant request thread insert failed:", threadErr.code, threadErr.message);
  return { id };
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

/** A follow-up from the tenant on their own request. The conversation is opened on first use. */
export async function addTenantMessage(
  g: GestionReader,
  user: { id: string },
  lease: { orgId: string },
  ticket: { id: string; title: string },
  body: string,
): Promise<{ id: string } | { error: RequestFailure }> {
  const text = str(body, 4000);
  if (!text) return { error: "invalid" };
  const { data: existing, error: findErr } = await g
    .from("conversations")
    .select("id")
    .eq("scope_type", "ticket")
    .eq("scope_id", ticket.id)
    .limit(1);
  if (findErr) return failure(findErr, "tenant conversation lookup");
  let conversationId = ((existing as Array<{ id: string }> | null) ?? [])[0]?.id;
  if (!conversationId) {
    const { data: created, error: createErr } = await g
      .from("conversations")
      .insert({ org_id: lease.orgId, scope_type: "ticket", scope_id: ticket.id, subject: ticket.title })
      .select("id")
      .single();
    if (createErr || !created) return failure(createErr, "tenant conversation insert");
    conversationId = String(created.id);
  }
  const { data, error } = await g
    .from("messages")
    .insert({ org_id: lease.orgId, conversation_id: conversationId, sender_kind: "tenant", sender_user_id: user.id, body: text })
    .select("id")
    .single();
  if (error || !data) return failure(error, "tenant message insert");
  return { id: String(data.id) };
}

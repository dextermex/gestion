/**
 * The tenant portal's vocabulary, shared by the server, the pages and the
 * tests. Nothing here touches a database.
 */

/** What an invitation is, as read by the owner. */
export interface InviteRow {
  id: string;
  contactId: string;
  leaseId: string | null;
  email: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  sentAt: string | null;
  delivery: "email" | "link" | null;
  createdAt: string;
}

export type InviteState = "none" | "sent" | "accepted" | "expired" | "revoked";

/** The state of one invitation row at a moment: accepted beats everything, then revoked, then expired. */
export function inviteState(row: Pick<InviteRow, "acceptedAt" | "revokedAt" | "expiresAt">, nowIso: string): Exclude<InviteState, "none"> {
  if (row.acceptedAt) return "accepted";
  if (row.revokedAt) return "revoked";
  if (row.expiresAt < nowIso) return "expired";
  return "sent";
}

/** The invitation that counts for a person on a lease: the latest one. */
export function inviteFor(invites: readonly InviteRow[], contactId: string, leaseId: string): InviteRow | null {
  const mine = invites
    .filter((i) => i.contactId === contactId && (i.leaseId === leaseId || i.leaseId === null))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return mine[0] ?? null;
}

/** What a tenant may ask for. */
export type RequestKind = "technical" | "document" | "question" | "other";
export const REQUEST_KINDS: readonly RequestKind[] = ["technical", "document", "question", "other"];

/** The technical categories the intervention system knows, as the tenant picks them. */
export const TECHNICAL_CATEGORIES = ["heating", "plumbing", "electrics", "damp_mould", "locks_keys", "appliances", "gas", "other"] as const;
export type TechnicalCategory = (typeof TECHNICAL_CATEGORIES)[number];

/** The intervention category a request lands in. A non-technical request is administrative. */
export function ticketCategoryFor(kind: RequestKind, category: string | null): string {
  if (kind !== "technical") return "administrative";
  return (TECHNICAL_CATEGORIES as readonly string[]).includes(category ?? "") ? (category as string) : "other";
}

/** A request kind read back from an intervention: its category and title carry it. */
export function requestKindOf(ticket: { category: string; description: string | null }): RequestKind {
  if (ticket.category !== "administrative") return "technical";
  const tag = (ticket.description ?? "").match(/^\[(document|question|other)\]/)?.[1];
  return (tag as RequestKind | undefined) ?? "other";
}

/** The four states a tenant follows, over the intervention system's nine. */
export type RequestState = "sent" | "in_progress" | "resolved" | "refused";
export function requestState(status: string): RequestState {
  if (status === "new" || status === "triaged") return "sent";
  if (status === "done" || status === "closed") return "resolved";
  if (status === "cancelled") return "refused";
  return "in_progress";
}

/**
 * What the owner tracks on a request: to handle, in progress, resolved, or
 * refused. The same ticket row carries it, through the intervention
 * system's own statuses: reading folds nine into four, writing picks the
 * plain one of each family. Read/unread is a property of the messages,
 * never of the request.
 */
export type RequestStatus = "todo" | "in_progress" | "resolved" | "refused";
export const REQUEST_STATUSES: readonly RequestStatus[] = ["todo", "in_progress", "resolved", "refused"];
export function requestStatusOf(ticketStatus: string): RequestStatus {
  const state = requestState(ticketStatus);
  return state === "sent" ? "todo" : state;
}
export function ticketStatusFor(status: RequestStatus): "new" | "in_progress" | "done" | "cancelled" {
  return status === "todo" ? "new" : status === "in_progress" ? "in_progress" : status === "resolved" ? "done" : "cancelled";
}
/** Resolved and refused requests are closed: they keep their history and take no more work. */
export function isRequestOpen(status: RequestStatus): boolean {
  return status === "todo" || status === "in_progress";
}

/**
 * A tenant's request is an intervention only once the owner says so (a work
 * order exists on it); anything raised by the manager, the owner or an
 * inventory defect is one from the start.
 */
export function isIntervention(t: { source: string; interventionId: string | null }): boolean {
  return t.source !== "tenant" || t.interventionId !== null;
}

/**
 * The thread id the desk's Messages uses for a request whose conversation
 * is not open yet: the first message opens the real one, the screen then
 * follows it. Never written to the database.
 */
export function pendingThreadId(requestId: string): string {
  return `request:${requestId}`;
}
export function isPendingThreadId(threadId: string): boolean {
  return threadId.startsWith("request:");
}

/** A ticket's reference as the owner's screens print it. */
export function ticketRef(id: string): string {
  return `INT-${id.slice(0, 8).toUpperCase()}`;
}

/** The storage folder a request's photos live in: the lease's own, under its workspace. */
export function attachmentFolder(orgId: string, leaseId: string): string {
  return `${orgId}/tickets/${leaseId}/`;
}

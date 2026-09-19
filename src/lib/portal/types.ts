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

/** The three states a tenant follows, over the intervention system's nine. */
export type RequestState = "sent" | "in_progress" | "resolved";
export function requestState(status: string): RequestState {
  if (status === "new" || status === "triaged") return "sent";
  if (status === "done" || status === "closed" || status === "cancelled") return "resolved";
  return "in_progress";
}

/** A ticket's reference as the owner's screens print it. */
export function ticketRef(id: string): string {
  return `INT-${id.slice(0, 8).toUpperCase()}`;
}

/** The storage folder a request's photos live in: the lease's own, under its workspace. */
export function attachmentFolder(orgId: string, leaseId: string): string {
  return `${orgId}/tickets/${leaseId}/`;
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The tenant's side of an invitation: what the link shows before any sign-in,
 * and the one call that links their account to the lease. Both are RPCs; the
 * database checks everything (token, expiry, revocation, e-mail, existing
 * link) inside one transaction, so two clicks or two tabs cannot disagree.
 */

export type InviteAddress = { street: string | null; number: string | null; postal_code: string | null; city: string | null };

export interface InvitePreview {
  state: "unknown" | "pending" | "accepted" | "expired" | "revoked";
  mine: boolean;
  firstName: string;
  email: string;
  orgName: string;
  propertyName: string;
  address: InviteAddress;
  unitLabel: string;
  leaseStatus: string;
  expiresAt: string | null;
}

/** Any client works here: the wrapper lives in `public` and is open to anon. */
export async function previewInvitation(client: Pick<SupabaseClient, "rpc">, token: string): Promise<InvitePreview> {
  const unknown: InvitePreview = {
    state: "unknown", mine: false, firstName: "", email: "", orgName: "", propertyName: "",
    address: { street: null, number: null, postal_code: null, city: null }, unitLabel: "", leaseStatus: "", expiresAt: null,
  };
  const { data, error } = await client.rpc("gestion_invite_preview", { p_token: token });
  if (error || !data || typeof data !== "object") {
    if (error) console.error("invitation preview failed:", error.code, error.message);
    return unknown;
  }
  const r = data as Record<string, unknown>;
  const s = (v: unknown): string => (typeof v === "string" ? v : "");
  const state = ["pending", "accepted", "expired", "revoked"].includes(s(r.state)) ? (s(r.state) as InvitePreview["state"]) : "unknown";
  const a = (r.address ?? {}) as Record<string, unknown>;
  return {
    state,
    mine: r.mine === true,
    firstName: s(r.first_name),
    email: s(r.email),
    orgName: s(r.org_name),
    propertyName: s(r.property_name),
    address: { street: s(a.street) || null, number: s(a.number) || null, postal_code: s(a.postal_code) || null, city: s(a.city) || null },
    unitLabel: s(r.unit_label),
    leaseStatus: s(r.lease_status),
    expiresAt: s(r.expires_at) || null,
  };
}

export type AcceptFailure = "sign_in" | "unknown" | "used" | "revoked" | "expired" | "wrong_account" | "linked_elsewhere" | "another_contact" | "storage_failed";

export interface Accepted {
  ok: true;
  leaseId: string | null;
  orgId: string;
  already: boolean;
}

function acceptFailure(message: string | undefined): AcceptFailure {
  const m = message ?? "";
  if (/sign in first/.test(m)) return "sign_in";
  if (/invitation unknown/.test(m)) return "unknown";
  if (/invitation used/.test(m)) return "used";
  if (/invitation revoked/.test(m)) return "revoked";
  if (/invitation expired/.test(m)) return "expired";
  if (/wrong account/.test(m)) return "wrong_account";
  if (/contact linked elsewhere/.test(m)) return "linked_elsewhere";
  if (/account linked to another contact/.test(m)) return "another_contact";
  return "storage_failed";
}

/** Runs as the signed-in user: the token is the only input, the account comes from the session. */
export async function acceptInvitation(g: Pick<SupabaseClient, "rpc">, token: string): Promise<Accepted | { error: AcceptFailure }> {
  const { data, error } = await g.rpc("portal_accept", { p_token: token });
  if (error) {
    const failure = acceptFailure(error.message);
    if (failure === "storage_failed") console.error("invitation accept failed:", error.code, error.message);
    return { error: failure };
  }
  const r = (data ?? {}) as Record<string, unknown>;
  return { ok: true, leaseId: typeof r.lease_id === "string" ? r.lease_id : null, orgId: String(r.org_id ?? ""), already: r.already === true };
}

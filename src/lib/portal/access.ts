import "server-only";
import type { OrgContext } from "@/lib/gestion/api";

/**
 * Withdrawing a person's access to the tenant space, from the owner's side.
 *
 * The link between a contact and an account is written by the tenant's own
 * acceptance (`portal_accept`) and nowhere else; the owner can only take it
 * back. Once taken back, the account reads nothing of this workspace (every
 * portal predicate goes through the contact's account), the invitations
 * still open for that person stop working, and the accepted one stays as
 * history. The person stays a contact, on every tenancy they are part of,
 * and can be invited again.
 */
export type UnlinkFailure = "not_found" | "not_linked" | "storage_failed";

export async function unlinkTenantAccount(ctx: OrgContext, contactId: string): Promise<{ ok: true; revoked: number } | { error: UnlinkFailure }> {
  const { g, org } = ctx;
  const { data: contact, error: findErr } = await g.from("contacts").select("id,user_id").eq("org_id", org.id).eq("id", contactId).maybeSingle();
  if (findErr) {
    if (findErr.code === "22P02") return { error: "not_found" };
    console.error("access lookup failed:", findErr.code, findErr.message);
    return { error: "storage_failed" };
  }
  if (!contact) return { error: "not_found" };
  if (!contact.user_id) return { error: "not_linked" };

  const { data: written, error } = await g.from("contacts").update({ user_id: null }).eq("org_id", org.id).eq("id", contactId).select("id");
  if (error) {
    console.error("access withdrawal failed:", error.code, error.message);
    return { error: "storage_failed" };
  }
  // Row-level security filters a row the caller may not edit without an error: nothing written is a refusal.
  if (!written?.length) return { error: "not_found" };

  // An invitation still open for the person would let the same account straight back in.
  const { data: open, error: openErr } = await g
    .from("portal_invites")
    .select("id")
    .eq("org_id", org.id)
    .eq("contact_id", contactId)
    .is("accepted_at", null)
    .is("revoked_at", null);
  if (openErr) console.error("open invitations lookup failed:", openErr.code, openErr.message);
  let revoked = 0;
  for (const inv of (open as Array<{ id: string }> | null) ?? []) {
    const { error: revokeErr } = await g.rpc("portal_revoke", { p_invite: inv.id });
    if (revokeErr) console.error("invitation revoke failed:", revokeErr.code, revokeErr.message);
    else revoked += 1;
  }
  return { ok: true, revoked };
}

import { NextRequest, NextResponse } from "next/server";
import { dbError, isUuid, refuseWithout, withOrg } from "@/lib/gestion/api";

/**
 * "Retirer l'accès": the tenant's account is no longer linked to the
 * contact, so the tenant space closes for it (every portal door asks that
 * link), and the contact's invitations still waiting are revoked so none of
 * them reopens it. Nothing else changes: the lease, the messages and the
 * documents stay with the workspace. A new invitation reopens the space.
 *
 * Open after the trial, like revoking: closing a door is never refused by
 * the subscription. The database lets a manager clear the link and never
 * set it (0030).
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg("act");
  if (ctx instanceof NextResponse) return ctx;
  const refused = await refuseWithout(ctx, "gestion.tenants.edit");
  if (refused) return refused;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { data: contact, error: readError } = await ctx.g.from("contacts").select("id,user_id").eq("id", id).eq("org_id", ctx.org.id).maybeSingle();
  if (readError) return dbError("contact access read", readError);
  if (!contact) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const linked = typeof contact.user_id === "string" && contact.user_id !== "";

  if (linked) {
    const { data: cleared, error } = await ctx.g.from("contacts").update({ user_id: null }).eq("id", id).eq("org_id", ctx.org.id).select("id");
    if (error) return dbError("contact access withdraw", error);
    if (!cleared || cleared.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // The invitations still waiting for this person would reopen the space: revoked.
  const { data: waiting, error: inviteError } = await ctx.g
    .from("portal_invites")
    .select("id")
    .eq("org_id", ctx.org.id)
    .eq("contact_id", id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());
  if (inviteError) return dbError("contact access invitations read", inviteError);
  let revoked = 0;
  for (const invite of waiting ?? []) {
    const { error } = await ctx.g.rpc("portal_revoke", { p_invite: invite.id });
    if (error) return dbError("contact access invitation revoke", error);
    revoked += 1;
  }

  // Nothing was open and nothing was waiting: nothing changed, and the answer says so.
  if (!linked && revoked === 0) return NextResponse.json({ error: "not_linked" }, { status: 409 });
  return NextResponse.json({ ok: true, withdrawn: linked, revoked });
}

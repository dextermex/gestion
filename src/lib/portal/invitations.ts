import "server-only";
import type { OrgContext } from "@/lib/gestion/api";
import type { Dict } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { escapeHtml, mailConfigured, sendMail } from "@/lib/mail";

/**
 * Inviting a tenant into their space, from the owner's side.
 *
 * An invitation is a row the database writes (`portal_invite_lease`): it
 * names the person, the lease, the e-mail it was sent to, and it expires. A
 * new one revokes the previous one, so a link that was forwarded around
 * stops working the moment the owner sends again. The token is the only
 * secret and never appears in any list: it is returned once, here, to be
 * mailed or handed over.
 */

export type InviteFailure = "not_found" | "forbidden" | "not_live" | "not_party" | "already_linked" | "no_email" | "storage_failed";

export interface CreatedInvite {
  id: string;
  token: string;
  email: string;
  expiresAt: string;
}

function failureOf(message: string | undefined): InviteFailure {
  const m = message ?? "";
  if (/lease not found/.test(m)) return "not_found";
  if (/not allowed/.test(m)) return "forbidden";
  if (/lease not live/.test(m)) return "not_live";
  if (/not a party/.test(m)) return "not_party";
  if (/already linked/.test(m)) return "already_linked";
  if (/no email/.test(m)) return "no_email";
  return "storage_failed";
}

export async function createInvitation(
  ctx: OrgContext,
  input: { leaseId: string; contactId: string },
): Promise<CreatedInvite | { error: InviteFailure }> {
  const { data, error } = await ctx.g.rpc("portal_invite_lease", { p_lease: input.leaseId, p_contact: input.contactId });
  if (error) {
    const failure = failureOf(error.message);
    if (failure === "storage_failed") console.error("invitation failed:", error.code, error.message);
    return { error: failure };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { invite_id: string; token: string; email: string; expires_at: string } | undefined;
  if (!row) return { error: "storage_failed" };
  return { id: String(row.invite_id), token: String(row.token), email: String(row.email), expiresAt: String(row.expires_at) };
}

export async function markDelivered(ctx: OrgContext, inviteId: string, delivery: "email" | "link"): Promise<boolean> {
  const { error } = await ctx.g.rpc("portal_invite_delivered", { p_invite: inviteId, p_delivery: delivery });
  if (error) console.error("invitation delivery mark failed:", error.code, error.message);
  return !error;
}

export async function revokeInvitation(ctx: OrgContext, inviteId: string): Promise<{ ok: true } | { error: "forbidden" | "storage_failed" }> {
  const { error } = await ctx.g.rpc("portal_revoke", { p_invite: inviteId });
  if (error) {
    if (/not allowed/.test(error.message ?? "")) return { error: "forbidden" };
    console.error("invitation revoke failed:", error.code, error.message);
    return { error: "storage_failed" };
  }
  return { ok: true };
}

/** The link the tenant opens. The token is the whole secret; nothing else is in the URL. */
export function invitationLink(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/invitation/${token}`;
}

export interface InvitationMailVars {
  firstName: string;
  orgName: string;
  propertyName: string;
  unitLabel: string;
  link: string;
  expiresOn: string;
}

/** The e-mail, in the dictionary's language: a subject, a plain text, and the same as minimal HTML. */
export function invitationMail(d: Dict, v: InvitationMailVars): { subject: string; text: string; html: string } {
  const t = d.tenant.invite;
  const home = `${v.unitLabel} · ${v.propertyName}`;
  const lines = [
    fmt(t.mailHello, { name: v.firstName }),
    "",
    fmt(t.mailBody, { org: v.orgName, home }),
    "",
    v.link,
    "",
    fmt(t.mailExpires, { date: v.expiresOn }),
    "",
    t.mailSignature,
  ];
  const html = `<div style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1f2924;max-width:560px">
<p>${escapeHtml(fmt(t.mailHello, { name: v.firstName }))}</p>
<p>${escapeHtml(fmt(t.mailBody, { org: v.orgName, home }))}</p>
<p><a href="${escapeHtml(v.link)}" style="display:inline-block;background:#17635c;color:#fff;text-decoration:none;font-weight:600;padding:10px 16px;border-radius:12px">${escapeHtml(t.mailButton)}</a></p>
<p style="color:#5d6b64;font-size:13px">${escapeHtml(v.link)}</p>
<p style="color:#5d6b64;font-size:13px">${escapeHtml(fmt(t.mailExpires, { date: v.expiresOn }))}</p>
<p>${escapeHtml(t.mailSignature)}</p>
</div>`;
  return { subject: fmt(t.mailSubject, { home }), text: lines.join("\n"), html };
}

export interface SendOutcome {
  id: string;
  email: string;
  link: string;
  expiresAt: string;
  /** Whether the e-mail actually left. When it did not, the link is what the owner hands over. */
  sent: boolean;
  reason: "not_configured" | "rejected" | "unreachable" | null;
}

/**
 * Creates the invitation, mails it when the deployment can, and records how
 * it went out. An invitation that could not be mailed is still valid: the
 * owner sees the link and passes it on.
 */
export async function sendInvitation(
  ctx: OrgContext,
  d: Dict,
  input: { leaseId: string; contactId: string; baseUrl: string; vars: Omit<InvitationMailVars, "link" | "expiresOn">; formatDate: (iso: string) => string },
): Promise<SendOutcome | { error: InviteFailure }> {
  const created = await createInvitation(ctx, input);
  if ("error" in created) return created;
  const link = invitationLink(input.baseUrl, created.token);
  let sent = false;
  let reason: SendOutcome["reason"] = null;
  if (mailConfigured()) {
    const mail = invitationMail(d, { ...input.vars, link, expiresOn: input.formatDate(created.expiresAt) });
    const result = await sendMail({ to: created.email, ...mail });
    if (result.sent) {
      sent = true;
      await markDelivered(ctx, created.id, "email");
    } else {
      reason = result.reason;
    }
  } else {
    reason = "not_configured";
  }
  return { id: created.id, email: created.email, link, expiresAt: created.expiresAt, sent, reason };
}

import type { Dict } from "@/lib/i18n/fr";
import { fmt, type Locale } from "@/lib/i18n/config";
import { formatDate } from "@/lib/types";
import { inviteFor, inviteState, type InviteRow, type InviteState } from "@/lib/portal/types";

/**
 * The owner's view of a lease's tenants and their portal access: one line
 * per party, with the state the badge shows, the sentence under it, and
 * whether an invitation may go out. Pure: it reads the dataset the page
 * already holds and never touches the database.
 */
export interface PartyInvitation {
  contactId: string;
  name: string;
  email: string | null;
  state: InviteState;
  inviteId: string | null;
  /** "Envoyée le …, valable jusqu'au …", "Compte relié le …", or nothing. */
  detail: string;
  /** An account is attached to the contact: the space is open, nothing to send. */
  linked: boolean;
  /** The lease is live, the contact has an address and no account yet. */
  canInvite: boolean;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function partyInvitations(
  data: { INVITES: readonly InviteRow[]; TODAY: string; contactById: (id: string) => { id: string; name: string; email: string | null; portalLinked?: boolean } },
  lease: { id: string; status: string; tenantContactIds: readonly string[] },
  d: Dict,
  locale: Locale,
  sample: boolean,
): PartyInvitation[] {
  // Sample cabinets live on their pinned day; a real account is simply now.
  const nowIso = sample ? `${data.TODAY}T12:00:00.000Z` : new Date().toISOString();
  const live = lease.status === "active" || lease.status === "notice";
  const date = (iso: string | null) => formatDate((iso ?? "").slice(0, 10), locale);
  return lease.tenantContactIds.map((cid) => {
    const c = data.contactById(cid);
    const invite = inviteFor(data.INVITES, cid, lease.id);
    const linked = c.portalLinked === true;
    const state: InviteState = linked ? "accepted" : invite ? inviteState(invite, nowIso) : "none";
    let detail = "";
    if (state === "accepted") detail = invite?.acceptedAt ? fmt(d.baux.portalAcceptedOn, { date: date(invite.acceptedAt) }) : "";
    else if (state === "sent" && invite) detail = fmt(d.baux.portalSentOn, { date: date(invite.sentAt ?? invite.createdAt), expires: date(invite.expiresAt) });
    else if (state === "revoked" && invite) detail = fmt(d.baux.portalRevokedOn, { date: date(invite.revokedAt) });
    else if (state === "expired" && invite) detail = fmt(d.baux.portalExpiredOn, { date: date(invite.expiresAt) });
    else if (!live) detail = d.baux.portalNotLive;
    else if (!EMAIL.test(c.email ?? "")) detail = d.baux.portalNoEmail;
    return {
      contactId: cid,
      name: c.name,
      email: c.email,
      state,
      inviteId: invite?.id ?? null,
      detail,
      linked,
      canInvite: live && !linked && EMAIL.test(c.email ?? ""),
    };
  });
}

/** The strings the invitation panel needs, and nothing else of the dictionary. */
export function inviteLabels(d: Dict) {
  return {
    title: d.baux.portalTitle,
    body: d.baux.portalBody,
    invite: d.baux.portalInvite,
    resend: d.baux.portalResend,
    revoke: d.baux.portalRevoke,
    revokeConfirm: d.baux.portalRevokeConfirm,
    confirm: d.common.yes,
    cancel: d.common.cancel,
    mailed: d.baux.portalMailed,
    notMailed: d.baux.portalNotMailed,
    linkLabel: d.baux.portalLinkLabel,
    copy: d.baux.portalCopy,
    copied: d.baux.portalCopied,
    noEmail: d.baux.portalNoEmail,
    notLive: d.baux.portalNotLive,
    failed: d.baux.portalFailed,
    sample: d.baux.portalSample,
  };
}
export type InviteLabels = ReturnType<typeof inviteLabels>;

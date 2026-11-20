import { cookies } from "next/headers";
import { InvitationView, invitationMetadata } from "./invitation-view";
import { INVITATION_COOKIE, isInvitationToken } from "@/lib/auth/invitation-token";

export const metadata = invitationMetadata;

/**
 * The invitation, its token read from the cookie the link left (never from
 * the address): signing in, creating the account and every provider's
 * return come back here with `next=/invitation`.
 */
export default async function InvitationPage() {
  const raw = (await cookies()).get(INVITATION_COOKIE)?.value;
  return <InvitationView token={isInvitationToken(raw) ? raw : null} />;
}

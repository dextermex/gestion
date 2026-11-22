import { InvitationView, invitationMetadata } from "../invitation-view";
import { isInvitationToken } from "@/lib/auth/invitation-token";

export const generateMetadata = invitationMetadata;

/**
 * The address an invitation e-mail names. A token of the right shape never
 * renders here: the middleware moves it into a cookie and sends the browser
 * to `/invitation`. What reaches this page is an address that names no
 * token, and it says the link is not valid.
 */
export default async function InvitationLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InvitationView token={isInvitationToken(token) ? token : null} />;
}

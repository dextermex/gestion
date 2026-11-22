import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import InvitationAccept from "@/components/gestion/InvitationAccept";
import { formatAddress } from "@/lib/gestion/address";
import { getI18n } from "@/lib/i18n";
import { previewInvitation, unknownInvitation } from "@/lib/portal/accept";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { authedClient, getSession } from "@/lib/supabase/server";
import { formatDate } from "@/lib/types";

/** The tab's title, in the visitor's language; never indexed. */
export async function invitationMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: `Morada Gestion · ${d.meta.invitation}`, robots: { index: false, follow: false } };
}

/**
 * "Votre logement vous attend sur Morada": the page an invitation link
 * opens, at `/invitation` (the middleware moves the link's token into a
 * cookie only the server reads, see src/lib/auth/invitation-token.ts). Signed out, it shows enough to recognise the home and offers to
 * create an account or sign in, both returning here. Signed in with the
 * invited address, it links the account and opens the space. Everything it
 * shows comes from one public preview function that answers with the same
 * few fields for anyone holding the link, and with nothing for a forged one.
 */
export async function InvitationView({ token }: { token: string | null }) {
  const { locale, d } = await getI18n();
  const session = await getSession();
  const client = session
    ? authedClient(session.accessToken)
    : createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  // No token in hand (the link was opened in another browser): the page says the link is not valid here.
  const preview = token ? await previewInvitation(client, token) : unknownInvitation();
  return (
    <InvitationAccept
      token={token ?? ""}
      t={d.tenant.invite}
      backLabel={d.auth.backToMorada}
      preview={{
        state: preview.state,
        mine: preview.mine,
        firstName: preview.firstName,
        email: preview.email,
        orgName: preview.orgName,
        home: [preview.unitLabel, preview.propertyName].filter(Boolean).join(" · "),
        address: formatAddress({
          street: preview.address.street ?? undefined,
          number: preview.address.number ?? undefined,
          postal_code: preview.address.postal_code ?? undefined,
          city: preview.address.city ?? undefined,
        }),
        expiresOn: preview.expiresAt ? formatDate(preview.expiresAt.slice(0, 10), locale) : "",
      }}
      session={session ? { email: session.email } : null}
    />
  );
}

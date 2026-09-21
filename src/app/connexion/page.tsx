import WelcomeAuth from "@/components/gestion/WelcomeAuth";
import { getI18n } from "@/lib/i18n";
import { getSession } from "@/lib/supabase/server";

export const metadata = { title: "Morada Gestion", robots: { index: false, follow: false } };

/** Only same-origin paths are accepted, so this is never an open redirect. */
function safeNext(raw: string | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/app";
  return raw;
}

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; onglet?: string; email?: string }>;
}) {
  const { locale, d } = await getI18n();
  const params = await searchParams;
  const next = safeNext(params.next);
  // A visitor the cookie already identifies is told so and chooses: carry on
  // with that account, or leave it to sign in or sign up with another. The
  // door never bounces anyone past itself, so a second account can always be
  // opened from here, whatever the browser remembers.
  const session = await getSession();
  // An invitation link lands here with the sign-up tab open and the invited
  // address filled in: the account is created for that address, nothing else.
  const email = typeof params.email === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(params.email) ? params.email.slice(0, 160) : "";
  return (
    <WelcomeAuth
      d={d}
      next={next}
      locale={locale}
      initialTab={params.onglet === "inscription" ? "signup" : "signin"}
      initialEmail={email}
      signedInAs={session?.email ?? null}
    />
  );
}

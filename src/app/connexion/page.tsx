import SignupFunnel from "@/components/signup/SignupFunnel";
import "../inscription/signup.css";
import { redirect } from "next/navigation";
import { safeSignupNext } from "@/lib/signup/model";
import { phoneSignupEntryEnabled } from "@/lib/signup/rollout";
import WelcomeAuth from "@/components/gestion/WelcomeAuth";
import { getI18n } from "@/lib/i18n";
import { getSession } from "@/lib/supabase/server";

export const metadata = { title: "Morada Gestion", robots: { index: false, follow: false } };

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; onglet?: string; email?: string; legacy?: string }>;
}) {
  const { locale, d } = await getI18n();
  const params = await searchParams;
  const next = safeSignupNext(params.next);
  // Until the entry flag is on, this page stays the email door the marketing
  // links have always reached; /inscription is only reachable by its own URL.
  const phoneEnabled = phoneSignupEntryEnabled();
  // A visitor the cookie already identifies is told so and chooses: carry on
  // with that account, or leave it to sign in or sign up with another. The
  // door never bounces anyone past itself, so a second account can always be
  // opened from here, whatever the browser remembers.
  const session = await getSession();
  // An invitation link lands here with the sign-up tab open and the invited
  // address filled in: the account is created for that address, nothing else.
  const email = typeof params.email === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(params.email) ? params.email.slice(0, 160) : "";
  const newSignup = phoneEnabled && params.legacy !== "1" && !email;
  if (newSignup && params.onglet === "inscription") redirect("/inscription?lang=" + locale + "&next=" + encodeURIComponent(next));
  if (newSignup) return <SignupFunnel locale={locale} next={next} signedIn={!!session} loginMode />;
  return (
    <WelcomeAuth
      newSignup={newSignup}
      phoneEnabled={phoneEnabled}
      d={d}
      next={next}
      locale={locale}
      initialTab={params.onglet === "inscription" ? "signup" : "signin"}
      initialEmail={email}
      signedInAs={session?.email ?? null}
    />
  );
}

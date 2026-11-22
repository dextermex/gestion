import type { Metadata } from "next";
import { APP_SHORT_NAME } from "@/lib/constants";
import { signupCopy } from "@/lib/i18n/signup";
import SignupFunnel from "@/components/signup/SignupFunnel";
import "../inscription/signup.css";
import { redirect } from "next/navigation";
import { safeSignupNext } from "@/lib/signup/model";
import { getLocale } from "@/lib/i18n";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import { getSession } from "@/lib/supabase/server";

/** The tab's name in the language the page is shown in: the `lang` of the link, else the person's. */
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ lang?: string }> }): Promise<Metadata> {
  const { lang } = await searchParams;
  const locale = LOCALES.includes(lang as Locale) ? (lang as Locale) : await getLocale();
  return { title: `${APP_SHORT_NAME} · ${signupCopy[locale].login}`, robots: { index: false, follow: false } };
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * The sign-in door: email and password, phone code, Google and Apple where
 * configured, and the password-recovery return (`?mode=reset`). Account
 * creation lives at /inscription only; every older signup link
 * (`?onglet=inscription`, from morada.lu CTAs, invitations and old emails)
 * is sent there with its destination, language, invited address and
 * placement tag intact.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; onglet?: string; email?: string; lang?: string; mode?: string; ref?: string }>;
}) {
  const params = await searchParams;
  const locale = LOCALES.includes(params.lang as Locale) ? params.lang as Locale : await getLocale();
  const email = typeof params.email === "string" && EMAIL.test(params.email) ? params.email.slice(0, 160) : "";
  const next = safeSignupNext(params.next);
  if (params.onglet === "inscription") {
    const target = new URLSearchParams({ lang: locale });
    if (params.next) target.set("next", next);
    if (email) target.set("email", email);
    if (typeof params.ref === "string" && /^[\w-]{1,40}$/.test(params.ref)) target.set("ref", params.ref);
    redirect("/inscription?" + target.toString());
  }
  const recovery = params.mode === "reset";
  const session = recovery ? null : await getSession();
  return <SignupFunnel locale={locale} next={next} signedIn={!!session} loginMode phoneLogin={params.mode === "phone"} initialEmail={email} recovery={recovery} />;
}

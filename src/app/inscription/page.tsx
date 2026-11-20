import type { Metadata } from "next";
import { APP_SHORT_NAME } from "@/lib/constants";
import { signupCopy } from "@/lib/i18n/signup";
import SignupFunnel from "@/components/signup/SignupFunnel";
import { getLocale } from "@/lib/i18n";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import { getSession } from "@/lib/supabase/server";
import "./signup.css";

/** The tab's name in the language the page is shown in: the `lang` of the link, else the person's. */
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ lang?: string }> }): Promise<Metadata> {
  const { lang } = await searchParams;
  const locale = LOCALES.includes(lang as Locale) ? (lang as Locale) : await getLocale();
  return { title: `${APP_SHORT_NAME} · ${signupCopy[locale].createAccount}`, robots: { index: false, follow: false } };
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ lang?: string; next?: string; mode?: string; oauth?: string; email?: string; ref?: string }> }) {
  const params = await searchParams;
  const locale = LOCALES.includes(params.lang as Locale) ? params.lang as Locale : await getLocale();
  // An invitation's address, prefilled at the email step; Auth still confirms it.
  const email = typeof params.email === "string" && EMAIL.test(params.email) ? params.email.slice(0, 160) : "";
  // The public site's placement tag (which button led here): a short word, kept on the account the funnel creates.
  const placement = typeof params.ref === "string" && /^[\w-]{1,40}$/.test(params.ref) ? params.ref : undefined;
  return <SignupFunnel locale={locale} next={params.next} signedIn={!!(await getSession())} loginMode={params.mode === "login" || params.mode === "phone"} phoneLogin={params.mode === "phone"} oauthIntent={params.oauth === "link" || params.oauth === "login" ? params.oauth : undefined} initialEmail={email} placement={placement} />;
}

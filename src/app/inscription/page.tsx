import SignupFunnel from "@/components/signup/SignupFunnel";
import { getLocale } from "@/lib/i18n";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import { getSession } from "@/lib/supabase/server";
import "./signup.css";

export const metadata = { title: "Morada · Create your account", robots: { index: false, follow: false } };
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ lang?: string; next?: string; mode?: string; oauth?: string }> }) {
  const params = await searchParams;
  const locale = LOCALES.includes(params.lang as Locale) ? params.lang as Locale : await getLocale();
  return <SignupFunnel locale={locale} next={params.next} signedIn={!!(await getSession())} loginMode={params.mode === "login" || params.mode === "phone"} phoneLogin={params.mode === "phone"} oauthIntent={params.oauth === "link" || params.oauth === "login" ? params.oauth : undefined} />;
}

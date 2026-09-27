import { notFound } from "next/navigation";
import SignupFunnel from "@/components/signup/SignupFunnel";
import { getLocale } from "@/lib/i18n";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import "../signup.css";
export const metadata = { title: "Morada · Signup preview", robots: { index: false, follow: false } };
export default async function SignupPreview({ searchParams }: { searchParams: Promise<{ lang?: string; mode?: string }> }) {
  // A separate, visibly labelled design harness. Never ships as an auth bypass.
  if (process.env.NODE_ENV !== "development") notFound();
  const params = await searchParams;
  const locale = LOCALES.includes(params.lang as Locale) ? params.lang as Locale : await getLocale();
  return <SignupFunnel locale={locale} preview loginMode={params.mode === "login" || params.mode === "phone"} phoneLogin={params.mode === "phone"} />;
}

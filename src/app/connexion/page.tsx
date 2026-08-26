import { redirect } from "next/navigation";
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
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale, d } = await getI18n();
  const params = await searchParams;
  const next = safeNext(params.next);
  if (await getSession()) redirect(next);
  return <WelcomeAuth d={d} next={next} locale={locale} />;
}

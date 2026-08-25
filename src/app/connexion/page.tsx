import { redirect } from "next/navigation";
import SignIn from "@/components/gestion/SignIn";
import { getI18n } from "@/lib/i18n";
import { getSession } from "@/lib/supabase/server";

export const metadata = { title: "Morada Gestion · Connexion", robots: { index: false, follow: false } };

/** Only same-origin paths are accepted, so this is never an open redirect. */
function safeNext(raw: string | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/app";
  return raw;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { d } = await getI18n();
  const params = await searchParams;
  const next = safeNext(params.next);
  if (await getSession()) redirect(next);
  return <SignIn d={d} next={next} />;
}

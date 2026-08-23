import type { Metadata } from "next";
import GestionShell from "@/components/gestion/Shell";
import { getI18n } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Morada Gestion",
  robots: { index: false, follow: false },
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { locale, d } = await getI18n();
  return (
    <GestionShell locale={locale} dict={d}>
      {children}
    </GestionShell>
  );
}

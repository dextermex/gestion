import type { Metadata, Viewport } from "next";
import { getLocale } from "@/lib/i18n";
import { htmlLang } from "@/lib/i18n/config";
import "./globals.css";

// Morada Gestion is its own environment in the Morada ecosystem — same design
// language as Morada.lu, different space. UI in FR/EN/DE/LU (cookie-switched).
const META: Record<string, { title: string; description: string }> = {
  fr: {
    title: "Morada Gestion — la gestion locative, simplement",
    description:
      "La plateforme de gestion locative de l'écosystème Morada : loyers, baux, conformité luxembourgeoise, rapprochement bancaire et pack fiscal — pour propriétaires et gestionnaires.",
  },
  en: {
    title: "Morada Gestion — property management, simply",
    description:
      "The Morada ecosystem's property-management platform: rents, leases, Luxembourg compliance, bank reconciliation and the year-end tax pack — for owners and managers.",
  },
  de: {
    title: "Morada Gestion — Immobilienverwaltung, einfach",
    description:
      "Die Immobilienverwaltungs-Plattform des Morada-Ökosystems: Mieten, Mietverträge, Luxemburger Compliance, Bankabgleich und Steuerpaket — für Eigentümer und Verwalter.",
  },
  lu: {
    title: "Morada Gestion — Immobiliëverwaltung, einfach",
    description:
      "D'Verwaltungsplattform vum Morada-Ökosystem: Loyeren, Bailen, Lëtzebuerger Konformitéit, Bankofgläich a Steierpak — fir Proprietären a Gestionnairen.",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return META[locale] ?? META.fr;
}

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={htmlLang(locale)} className="scroll-smooth">
      <body className="min-h-dvh bg-sand-50 text-ink antialiased">{children}</body>
    </html>
  );
}

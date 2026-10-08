import type { Metadata, Viewport } from "next";
import { APP_SHORT_NAME } from "@/lib/constants";
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
  return {
    ...(META[locale] ?? META.fr),
    // Added to a phone's home screen, the app opens on its own, without the
    // browser around it (the manifest is app/manifest.ts, the icons sit next
    // to it). The status bar stays the light one: the app's bars are white
    // and there is no dark mode. The short name fits under an iPhone icon.
    appleWebApp: { capable: true, title: APP_SHORT_NAME, statusBarStyle: "default" },
    // Safari's own name for it, beside the standard one Next writes.
    other: { "apple-mobile-web-app-capable": "yes" },
  };
}

// `viewportFit: cover` lets the page reach an iPhone's rounded corners and
// home indicator; the safe-area insets (globals.css) keep the chrome and the
// content out of them. The browser's own bar takes the white of the app's
// bars (`themeColor`), and a phone set to darken websites leaves this light
// design as it is (`only light`: Morada has no dark mode). On Android the
// keyboard shrinks the page instead of covering it, so a conversation keeps
// its header and its composer in view while typing (`resizes-content`).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
  colorScheme: "only light",
  interactiveWidget: "resizes-content",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={htmlLang(locale)} className="scroll-smooth">
      <body className="min-h-dvh bg-sand-50 text-ink antialiased">{children}</body>
    </html>
  );
}

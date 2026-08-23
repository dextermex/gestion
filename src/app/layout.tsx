import type { Metadata, Viewport } from "next";
import "./globals.css";

// Morada Gestion is its own environment in the Morada ecosystem — same design
// language as Morada.lu, different space. The app UI is French-only.
export const metadata: Metadata = {
  title: "Morada Gestion — la gestion locative, simplement",
  description:
    "La plateforme de gestion locative de l'écosystème Morada : loyers, baux, conformité luxembourgeoise, rapprochement bancaire et pack fiscal — pour propriétaires et gestionnaires.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className="scroll-smooth">
      <body className="min-h-dvh bg-sand-50 text-ink antialiased">{children}</body>
    </html>
  );
}

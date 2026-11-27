import type { Metadata, Viewport } from "next";
import { APP_SHORT_NAME } from "@/lib/constants";
import { ErrorCopyProvider } from "@/components/RouteFallback";
import { getDict, getLocale } from "@/lib/i18n";
import { htmlLang } from "@/lib/i18n/config";
import "./globals.css";

// Morada Gestion is its own environment in the Morada ecosystem: same design
// language as Morada.lu, different space. UI in FR/EN/DE/LU (cookie-switched);
// the tab's name and the description a search engine or a link preview reads
// come from the dictionary of the person's language (`meta`).
export async function generateMetadata(): Promise<Metadata> {
  const { meta } = getDict(await getLocale());
  return {
    title: meta.title,
    description: meta.description,
    // Added to a phone's home screen, the app opens on its own, without the
    // browser around it (the manifest is app/manifest.ts, the icons sit next
    // to it). The status bar stays the light one: the app's bars are white
    // and there is no dark mode. The short name fits under an iPhone icon.
    appleWebApp: { capable: true, title: APP_SHORT_NAME, statusBarStyle: "default" },
    // Safari's own name for it, beside the standard one Next writes.
    other: { "apple-mobile-web-app-capable": "yes" },
    // An IBAN, a cadastral reference or a file number is not a phone number:
    // a phone must not turn such strings into call links of its own accord.
    // Real phone numbers are links already (tel:), where the product says so.
    formatDetection: { telephone: false },
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
  const { errors } = getDict(locale);
  // The guided tour's arrival is started by a script before first paint, as an attribute on <html>
  // (src/components/gestion/onboarding/SetupTour.tsx): the one difference from the server's HTML, and expected.
  return (
    <html lang={htmlLang(locale)} className="scroll-smooth" suppressHydrationWarning>
      <body className="min-h-dvh bg-sand-50 text-ink antialiased">
        {/* An error screen is a client component: it gets its few lines, in the person's language, from here. */}
        <ErrorCopyProvider copy={{ title: errors.errorTitle, body: errors.errorBody, retry: errors.retry, toHome: errors.toHome, toTenantHome: errors.toTenantHome, toSpace: errors.toSpace }}>{children}</ErrorCopyProvider>
      </body>
    </html>
  );
}

import type { MetadataRoute } from "next";
import { APP_NAME, APP_SHORT_NAME } from "@/lib/constants";

/**
 * The web app manifest (served at /manifest.webmanifest, linked from every
 * page by Next). It is what turns "Add to Home Screen" into an installed
 * app: its own icon, its own window without the browser's bars, the
 * sand-coloured splash while it starts, the white of the app's bars in the
 * system's status area. It opens where the site's root sends each account:
 * the owner's space, the tenant's space, or the sign-in page. The icons are
 * drawn from the logo by scripts/app-icons.mjs.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: APP_NAME,
    short_name: APP_SHORT_NAME,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#faf7f2",
    theme_color: "#ffffff",
    lang: "fr",
    dir: "ltr",
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

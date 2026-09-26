import type { MetadataRoute } from "next";

/** Home-screen identity: the Morada mark on brand teal, maskable for Android. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Morada Gestion",
    short_name: "Morada",
    description: "La gestion locative pour le Luxembourg.",
    start_url: "/app",
    display: "standalone",
    background_color: "#faf7f2",
    theme_color: "#10505c",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

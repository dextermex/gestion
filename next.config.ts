import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
  },
  // The PDF renderer reads its own font data at runtime: left to Node, not bundled.
  serverExternalPackages: ["@react-pdf/renderer"],
  // Metadata in the <head> for every visitor, not streamed into the <body>
  // (Next's default for anything but a few named bots): a phone reads the
  // manifest link and the home-screen tags there only, so "Add to Home
  // Screen" found no manifest. Nothing is lost: the only generateMetadata
  // (the root layout) reads one cookie.
  htmlLimitedBots: /.*/,
  // Response security headers. The session cookie is JS-readable and shared
  // across *.morada.lu by design (docs/SSO-PROPOSITION.md), so browser-side
  // containment is the defence-in-depth that remains. X-Frame-Options,
  // Referrer-Policy and X-Content-Type-Options are enforced (safe, no app
  // change). The Content-Security-Policy ships Report-Only first: it reports
  // violations without blocking, so it cannot break the running app; promote
  // it to an enforced Content-Security-Policy once its reports are clean.
  async headers() {
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://js.stripe.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https://*.supabase.co https://*.supabase.in",
      "connect-src 'self' https://*.supabase.co https://*.supabase.in wss://*.supabase.co https://*.ingest.sentry.io https://api.stripe.com https://challenges.cloudflare.com",
      "frame-src https://challenges.cloudflare.com https://js.stripe.com",
      "media-src 'self' blob:",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy-Report-Only", value: csp },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

// Error monitoring (see src/lib/monitoring.ts and docs/QUALITY.md). The build
// plugin only instruments the bundles; source maps are uploaded when a
// SENTRY_AUTH_TOKEN is present in the build environment, never otherwise.
export default withSentryConfig(nextConfig, {
  silent: true,
  telemetry: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  widenClientFileUpload: false,
  webpack: { treeshake: { removeDebugLogging: true }, automaticVercelMonitors: false },
});

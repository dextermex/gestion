import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

/**
 * Headers every answer carries. The policy holds only directives that need
 * no nonce (a script policy would need one, and a nonce makes every page a
 * function call): who may frame the application (itself, for the bank
 * journey's return), where a base address or a form may point, and no
 * plug-in content. The rest tells the browser not to guess a file's type,
 * what a link out may say about where it came from, which device features
 * no page here uses, and to come back over HTTPS.
 */
export const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), browsing-topics=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
] as const;

/**
 * The fuller policy, reported and not enforced: the session cookie is
 * readable by scripts and shared across *.morada.lu by design
 * (docs/SSO-PROPOSITION.md), so containing what a page may load is the
 * defence that remains. Report-Only cannot break the running app; it is
 * promoted to an enforced policy once its reports are clean.
 */
const REPORTED_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://js.stripe.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https://*.supabase.co https://*.supabase.in",
  "connect-src 'self' https://*.supabase.co https://*.supabase.in wss://*.supabase.co https://*.ingest.sentry.io https://api.stripe.com https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com https://js.stripe.com",
  "media-src 'self' blob:",
].join("; ");

const nextConfig: NextConfig = {
  // The framework's name and version are nobody's business.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [...SECURITY_HEADERS, { key: "Content-Security-Policy-Report-Only", value: REPORTED_POLICY }] }];
  },
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

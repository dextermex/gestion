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

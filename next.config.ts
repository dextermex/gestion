import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
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

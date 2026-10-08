import { SENTRY_DSN, monitoringOptions } from "@/lib/monitoring";

/**
 * The browser side of error monitoring, loaded by Next.js before the app
 * hydrates. Errors only, scrubbed as `src/lib/monitoring.ts` says; no
 * session replay, no tracing. The SDK itself is fetched only when a DSN is
 * set at build time: without one (every preview, and production today) not
 * a byte of it reaches a phone, and the hook below does nothing.
 */
type Sdk = typeof import("@sentry/nextjs");
let sdk: Sdk | null = null;

if (SENTRY_DSN !== "") {
  import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.init({
        ...monitoringOptions(),
        // Nothing about the person or their screen is recorded.
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
      });
      sdk = Sentry;
    })
    .catch(() => null);
}

/** Next's hook for client-side navigations, handed on to the SDK once it is here. */
export const onRouterTransitionStart: Sdk["captureRouterTransitionStart"] = (href, navigationType) => {
  sdk?.captureRouterTransitionStart(href, navigationType);
};

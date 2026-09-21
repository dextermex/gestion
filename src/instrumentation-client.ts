import * as Sentry from "@sentry/nextjs";
import { monitoringOptions } from "@/lib/monitoring";

/**
 * The browser side of error monitoring, loaded by Next.js before the app
 * hydrates. Errors only, scrubbed as `src/lib/monitoring.ts` says; no
 * session replay, no tracing. Inert without a DSN.
 */
Sentry.init({
  ...monitoringOptions(),
  // Nothing about the person or their screen is recorded.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

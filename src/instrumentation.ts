import * as Sentry from "@sentry/nextjs";
import { monitoringOptions } from "@/lib/monitoring";

/**
 * Next.js instrumentation: the server runtimes initialise error monitoring
 * here, once, and every unhandled error in a server component, route
 * handler or middleware is reported through `onRequestError` with the
 * scrubbing `src/lib/monitoring.ts` applies. Inert without a DSN.
 */
export function register(): void {
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init(monitoringOptions());
  }
}

export const onRequestError = Sentry.captureRequestError;

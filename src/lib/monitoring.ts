import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/**
 * Production error monitoring, configured once for the browser, the Node
 * runtime and the edge runtime. Off unless `NEXT_PUBLIC_SENTRY_DSN` is set,
 * so a preview or a local run sends nothing.
 *
 * What leaves the building is the error and where it happened, nothing
 * about the people in it: no user object, no cookies, no headers, no
 * request bodies, no session replay, no performance traces, and the few
 * things that carry identity in this product (e-mail addresses, IBANs,
 * invitation tokens in URLs, Supabase access tokens in link fragments) are
 * redacted before the event is sent.
 */
export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? "";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}\s?[A-Z0-9]{1,4}\b/g;
const INVITATION = /\/invitation\/[A-Za-z0-9_-]{16,}/g;
const TOKEN_QUERY = /([?&#](?:access_token|refresh_token|token|code)=)[^&#\s]+/gi;

/** Free text with the identifying parts blanked. */
export function redact(text: string): string {
  return text
    .replace(INVITATION, "/invitation/[token]")
    .replace(TOKEN_QUERY, "$1[redacted]")
    .replace(EMAIL, "[email]")
    .replace(IBAN, "[iban]");
}

/** The event, stripped of everything that names a person, before it is sent. */
export function scrub(event: ErrorEvent, _hint?: EventHint): ErrorEvent | null {
  void _hint;
  delete event.user;
  delete event.server_name;
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
    if (event.request.url) event.request.url = redact(event.request.url);
    if (event.request.query_string) event.request.query_string = "[redacted]";
  }
  if (event.message) event.message = redact(event.message);
  if (event.transaction) event.transaction = redact(event.transaction);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = redact(ex.value);
  }
  event.breadcrumbs = (event.breadcrumbs ?? [])
    // Console lines can carry anything: they stay home. The rest (a route,
    // a request URL, a status) is kept with its strings redacted.
    .filter((b) => b.category !== "console")
    .map((b) => ({
      ...b,
      message: b.message ? redact(b.message) : b.message,
      data: b.data ? Object.fromEntries(Object.entries(b.data).map(([k, v]) => [k, typeof v === "string" ? redact(v) : v])) : b.data,
    }));
  return event;
}

/** The options every runtime initialises with. */
export function monitoringOptions() {
  return {
    dsn: SENTRY_DSN,
    enabled: SENTRY_DSN !== "",
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    // Errors only. No performance traces, no session replay, no profiling.
    tracesSampleRate: 0,
    sendDefaultPii: false,
    attachStacktrace: true,
    maxBreadcrumbs: 20,
    beforeSend: scrub,
  };
}

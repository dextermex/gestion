import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { monitoringOptions, redact, scrub } from "@/lib/monitoring";

/**
 * What error monitoring may send: the error and where it happened, never
 * who was there. These pin the redaction and the stripping.
 */
describe("redact", () => {
  it("blanks e-mail addresses, IBANs, invitation tokens and link tokens", () => {
    expect(redact("tenant anna.weber@example.lu could not open /invitation/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"))
      .toBe("tenant [email] could not open /invitation/[token]");
    expect(redact("payer IBAN LU28 0019 4006 4475 0000 rejected")).toBe("payer IBAN [iban] rejected");
    expect(redact("https://app.morada.lu/connexion#access_token=eyJabc.def&refresh_token=xyz&type=signup"))
      .toBe("https://app.morada.lu/connexion#access_token=[redacted]&refresh_token=[redacted]&type=signup");
    expect(redact("https://app.morada.lu/invitation/x?code=abcd1234")).toBe("https://app.morada.lu/invitation/x?code=[redacted]");
  });

  it("leaves ordinary text alone", () => {
    expect(redact("rent_period_status returned 0 rows for lease 3b")).toBe("rent_period_status returned 0 rows for lease 3b");
  });
});

describe("scrub", () => {
  it("strips the person and the request's identifying parts, redacts the rest", () => {
    const event = {
      message: "failed for anna.weber@example.lu",
      transaction: "/invitation/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      user: { id: "u1", email: "anna.weber@example.lu", ip_address: "1.2.3.4" },
      server_name: "vercel-1",
      request: {
        url: "https://app.morada.lu/invitation/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        cookies: { morada_auth: "b64.secret" },
        headers: { cookie: "morada_auth=b64.secret", authorization: "Bearer x" },
        data: { password: "hunter2" },
        query_string: "token=abc",
      },
      exception: { values: [{ type: "Error", value: "IBAN LU28 0019 4006 4475 0000 unknown for luc.weber@example.lu" }] },
      breadcrumbs: [
        { category: "console", message: "password is hunter2" },
        { category: "fetch", message: "GET", data: { url: "https://x.supabase.co/rest/v1/contacts?email=eq.anna.weber@example.lu", status_code: 200 } },
        { category: "navigation", data: { from: "/app", to: "/app/biens" } },
        { category: "navigation", data: { from: "/connexion", to: "/invitation/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" } },
      ],
    } as unknown as ErrorEvent;

    const out = scrub(event)!;
    expect(out.user).toBeUndefined();
    expect(out.server_name).toBeUndefined();
    expect(out.request?.cookies).toBeUndefined();
    expect(out.request?.headers).toBeUndefined();
    expect(out.request?.data).toBeUndefined();
    expect(out.request?.query_string).toBe("[redacted]");
    expect(out.request?.url).toBe("https://app.morada.lu/invitation/[token]");
    expect(out.message).toBe("failed for [email]");
    expect(out.transaction).toBe("/invitation/[token]");
    expect(out.exception?.values?.[0].value).toBe("IBAN [iban] unknown for [email]");
    expect(out.breadcrumbs?.map((b) => b.category)).toEqual(["fetch", "navigation", "navigation"]);
    expect(out.breadcrumbs?.[2].data?.to).toBe("/invitation/[token]");
    // The address pattern swallows the PostgREST operator prefix: more blanked, never less.
    expect(out.breadcrumbs?.[0].data?.url).toBe("https://x.supabase.co/rest/v1/contacts?email=[email]");
    expect(out.breadcrumbs?.[1].data).toEqual({ from: "/app", to: "/app/biens" });
  });
});

describe("monitoringOptions", () => {
  it("is off without a DSN, sends no PII and no traces", () => {
    const o = monitoringOptions();
    expect(o.enabled).toBe(false);
    expect(o.sendDefaultPii).toBe(false);
    expect(o.tracesSampleRate).toBe(0);
    expect(o.beforeSend).toBe(scrub);
  });
});

import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { DAY } from "@/domain/billing/trial";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";
import { de } from "@/lib/i18n/de";
import { lu } from "@/lib/i18n/lu";
import type { Locale } from "@/lib/i18n/config";
import type { MailMessage } from "@/lib/mail";
import { META, subscriptionView } from "@/lib/billing/service";
import { reminderMail, sendTrialReminders } from "@/lib/billing/reminders";

const NOW = 1_790_000_000;
const DICTS = { fr, en, de, lu };

const customer = (id: string, over: Record<string, string> = {}, email: string | null = `${id}@example.lu`) =>
  ({ id, object: "customer", created: NOW - 40 * DAY, email, metadata: { [META.app]: "gestion", [META.locale]: "fr", ...over } });

/** A subscription in its trial, its customer expanded as the search returns it. */
const trialing = (name: string, daysLeft: number, over: { reminders?: string; locale?: string; cancel?: boolean; email?: string | null } = {}) => {
  const trialEnd = NOW + daysLeft * DAY - 3600;
  return {
    id: `sub_${name}`, object: "subscription", status: "trialing", created: NOW - 2 * DAY, start_date: NOW - 2 * DAY, trial_end: trialEnd, cancel_at_period_end: over.cancel ?? false, cancel_at: null,
    customer: customer(`cus_${name}`, over.locale ? { [META.locale]: over.locale } : {}, over.email === undefined ? `cus_${name}@example.lu` : over.email),
    metadata: { [META.app]: "gestion", [META.rhythm]: "quarter", [META.pricing]: "portfolio", [META.lots]: "4", [META.base]: "6000", ...(over.reminders ? { [META.reminders]: over.reminders } : {}) },
    default_payment_method: null,
    items: { object: "list", has_more: false, data: [{ id: "si_1", quantity: 1, current_period_end: trialEnd, price: { id: "price_1", unit_amount: 6000, recurring: { interval: "month", interval_count: 3 }, metadata: {} } }] },
  };
};

function standIn(subs: unknown[]) {
  const updates: { id: string; form: URLSearchParams }[] = [];
  const searches: URLSearchParams[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = String(init?.method ?? "GET").toUpperCase();
    let body: unknown = { error: { type: "invalid_request_error", message: "no stand-in" } };
    let status = 404;
    if (url.pathname === "/v1/subscriptions/search") { status = 200; searches.push(url.searchParams); body = { object: "search_result", data: subs, has_more: false, next_page: null, url: url.pathname }; }
    else if (url.pathname.startsWith("/v1/subscriptions/") && method === "POST") {
      status = 200;
      const id = url.pathname.split("/").pop()!;
      updates.push({ id, form: new URLSearchParams(String(init?.body ?? "")) });
      body = { id, object: "subscription" };
    }
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { stripe: new Stripe("sk_test_standin0000000000", { httpClient: Stripe.createFetchHttpClient(fetchImpl), maxNetworkRetries: 0, telemetry: false }), updates, searches };
}

const mailer = () => {
  const sent: MailMessage[] = [];
  return { sent, send: async (m: MailMessage) => { sent.push(m); return { sent: true as const, id: "m" }; } };
};
const deps = (send: (m: MailMessage) => Promise<{ sent: true; id: string } | { sent: false; reason: string }>, over = {}) =>
  ({ send, dict: (l: Locale) => DICTS[l], appUrl: "https://app.morada.lu", ...over }) as Parameters<typeof sendTrialReminders>[2];

describe("trial reminder e-mails", () => {
  it("mails each trial seven days and two days before its first charge, once each, recording it on the subscription", async () => {
    const subs = [
      trialing("week", 6),                                  // six days left: the week's reminder
      trialing("early", 12),                                // nothing due yet
      trialing("last", 2, { reminders: "d7", locale: "de" }), // two days left, the week's sent: the last one
      trialing("done", 1, { reminders: "d7,d2" }),          // both already sent
      trialing("stopped", 5, { cancel: true }),             // cancelled: nothing will be charged
      trialing("nomail", 6, { email: null }),               // no address: nobody to write to
    ];
    const { stripe, updates, searches } = standIn(subs);
    const { sent, send } = mailer();
    const run = await sendTrialReminders(stripe, NOW, deps(send));
    expect(searches[0].get("query")).toBe("status:'trialing' AND metadata['morada_app']:'gestion'");
    expect(searches[0].get("expand[0]")).toBe("data.customer");
    expect(run).toEqual({ checked: 6, sent: 2, failed: 0, deferred: 0 });
    expect(sent.map((m) => m.to).sort()).toEqual(["cus_last@example.lu", "cus_week@example.lu"]);
    const week = sent.find((m) => m.to === "cus_week@example.lu")!;
    expect(week.subject).toContain("Votre abonnement Morada Gestion démarre le");
    expect(week.text).toContain("60");
    expect(week.html).toContain("https://app.morada.lu/app/abonnement");
    const last = sent.find((m) => m.to === "cus_last@example.lu")!;
    expect(last.subject).toContain("Erinnerung: Ihr Morada-Gestion-Abonnement beginnt am");
    expect(updates.map((u) => [u.id, u.form.get(`metadata[${META.reminders}]`)]).sort()).toEqual([["sub_last", "d7,d2"], ["sub_week", "d7"]]);
  });

  it("does not record a reminder the mail service refused, so the next run tries again", async () => {
    const { stripe, updates } = standIn([trialing("week", 6)]);
    const run = await sendTrialReminders(stripe, NOW, deps(async () => ({ sent: false, reason: "not_configured" })));
    expect(run).toEqual({ checked: 1, sent: 0, failed: 1, deferred: 0 });
    expect(updates).toHaveLength(0);
  });

  it("stops by itself when its time is up, nearest first charge first, and counts what it leaves", async () => {
    // Listed far first: the run still begins with the trial that charges in two days.
    const { stripe } = standIn([trialing("far", 6), trialing("mid", 5), trialing("near", 2)]);
    let at = 0;
    const { sent, send } = mailer();
    const run = await sendTrialReminders(stripe, NOW, deps(send, { budgetMs: 50_000, clock: () => (at += 20_000) }));
    expect(run).toEqual({ checked: 2, sent: 2, failed: 0, deferred: 1 });
    expect(sent.map((m) => m.to)).toEqual(["cus_near@example.lu", "cus_mid@example.lu"]);
  });

  it("writes both reminders in all four languages, without em dashes, arrows or a placeholder left", () => {
    const sub = subscriptionView(trialing("x", 2) as unknown as Stripe.Subscription);
    for (const locale of ["fr", "en", "de", "lu"] as const) {
      for (const kind of ["d7", "d2"] as const) {
        const mail = reminderMail(kind, sub, DICTS[locale], locale, "https://app.morada.lu/app/abonnement");
        for (const part of [mail.subject, mail.text]) expect(part).not.toMatch(/[—→]|\{\w+\}/);
        expect(mail.html).toContain("https://app.morada.lu/app/abonnement");
      }
    }
  });
});

import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { DAY } from "@/domain/billing/trial";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";
import { de } from "@/lib/i18n/de";
import { lu } from "@/lib/i18n/lu";
import type { Locale } from "@/lib/i18n/config";
import type { MailMessage } from "@/lib/mail";
import { META, customerFacts, subscriptionView } from "@/lib/billing/service";
import { reminderMail, sendTrialReminders } from "@/lib/billing/reminders";

const NOW = 1_790_000_000;
const DICTS = { fr, en, de, lu };
const ORG_A = "0f0f0f0f-0000-4000-8000-0000000000a1";
const ORG_B = "0f0f0f0f-0000-4000-8000-0000000000b2";
const ORG_C = "0f0f0f0f-0000-4000-8000-0000000000c3";

const customer = (id: string, org: string, created: number, over: Record<string, string> = {}, email = `${id}@example.lu`) =>
  ({ id, object: "customer", created, email, metadata: { [META.app]: "gestion", [META.org]: org, [META.rhythm]: "quarter", [META.locale]: "fr", ...over } });

const trialing = (customerId: string, trialEnd: number) => ({
  id: `sub_${customerId}`, object: "subscription", status: "trialing", created: NOW - 2 * DAY, start_date: NOW - 2 * DAY, trial_end: trialEnd, cancel_at_period_end: false, cancel_at: null,
  metadata: { [META.rhythm]: "quarter", [META.pricing]: "portfolio", [META.lots]: "4", [META.base]: "6000" }, default_payment_method: null,
  items: { object: "list", has_more: false, data: [{ id: "si_1", quantity: 1, current_period_end: trialEnd, price: { id: "price_1", unit_amount: 6000, recurring: { interval: "month", interval_count: 3 }, metadata: {} } }] },
});

function standIn(customers: unknown[], subs: Record<string, unknown[]>) {
  const updates: { id: string; form: URLSearchParams }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = String(init?.method ?? "GET").toUpperCase();
    let body: unknown = { error: { type: "invalid_request_error", message: "no stand-in" } };
    let status = 404;
    if (url.pathname === "/v1/customers/search") { status = 200; body = { object: "search_result", data: customers, has_more: false, next_page: null, url: url.pathname }; }
    else if (url.pathname === "/v1/subscriptions") { status = 200; body = { object: "list", data: subs[url.searchParams.get("customer") ?? ""] ?? [], has_more: false, url: url.pathname }; }
    else if (url.pathname.startsWith("/v1/customers/") && method === "POST") {
      status = 200;
      const id = url.pathname.split("/").pop()!;
      updates.push({ id, form: new URLSearchParams(String(init?.body ?? "")) });
      body = { id, object: "customer" };
    }
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { stripe: new Stripe("sk_test_standin0000000000", { httpClient: Stripe.createFetchHttpClient(fetchImpl), maxNetworkRetries: 0, telemetry: false }), updates };
}

describe("trial reminder e-mails", () => {
  it("mails each workspace the reminder it is due, once, recording it at Stripe", async () => {
    const created = (daysLeft: number) => NOW - (30 - daysLeft) * DAY + 3600;
    const customers = [
      customer("cus_week", ORG_A, created(6)),                                   // six days left: the week's reminder
      customer("cus_twin", ORG_A, created(6) + 600),                               // a duplicate of the same workspace: ignored
      customer("cus_done", ORG_B, created(1), { [META.reminders]: "d7,d2" }),      // both already sent
      customer("cus_card", ORG_C, created(5), { [META.locale]: "de" }),            // a card on file: the first charge announced
    ];
    const { stripe, updates } = standIn(customers, { cus_card: [trialing("cus_card", created(5) + 30 * DAY)] });
    const sent: MailMessage[] = [];
    const run = await sendTrialReminders(stripe, NOW, { send: async (m) => { sent.push(m); return { sent: true, id: "m" }; }, dict: (l: Locale) => DICTS[l], appUrl: "https://app.morada.lu" });
    expect(run).toEqual({ checked: 3, sent: 2, failed: 0 });
    expect(sent.map((m) => m.to).sort()).toEqual(["cus_card@example.lu", "cus_week@example.lu"]);
    const week = sent.find((m) => m.to === "cus_week@example.lu")!;
    expect(week.subject).toContain("Votre essai Morada Gestion se termine le");
    expect(week.html).toContain("https://app.morada.lu/app/abonnement");
    const card = sent.find((m) => m.to === "cus_card@example.lu")!;
    expect(card.subject).toContain("Ihr Morada-Gestion-Abonnement beginnt am");
    expect(card.text).toContain("60,00");
    expect(updates.map((u) => [u.id, u.form.get(`metadata[${META.reminders}]`)]).sort()).toEqual([["cus_card", "d7"], ["cus_week", "d7"]]);
  });

  it("does not record a reminder the mail service refused, so the next run tries again", async () => {
    const { stripe, updates } = standIn([customer("cus_week", ORG_A, NOW - 24 * DAY)], {});
    const run = await sendTrialReminders(stripe, NOW, { send: async () => ({ sent: false, reason: "not_configured" }), dict: (l: Locale) => DICTS[l], appUrl: "https://app.morada.lu" });
    expect(run).toEqual({ checked: 1, sent: 0, failed: 1 });
    expect(updates).toHaveLength(0);
  });

  it("writes every reminder in all four languages, without em dashes or arrows", () => {
    const facts = customerFacts(customer("cus_x", ORG_A, NOW - 29 * DAY) as unknown as Stripe.Customer);
    const card = subscriptionView(trialing("cus_x", NOW + 2 * DAY) as unknown as Stripe.Subscription);
    for (const locale of ["fr", "en", "de", "lu"] as const) {
      for (const [kind, subscription] of [["d7", null], ["d2", null], ["ended", null], ["d7", card]] as const) {
        const mail = reminderMail(kind, { customer: facts, subscription }, DICTS[locale], locale, "https://app.morada.lu/app/abonnement", NOW);
        for (const part of [mail.subject, mail.text]) {
          expect(part).not.toMatch(/[—→]|\{\w+\}/);
        }
        expect(mail.html).toContain("https://app.morada.lu/app/abonnement");
      }
    }
  });
});

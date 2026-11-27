import "server-only";
import type Stripe from "stripe";
import { DEFAULT_RHYTHM } from "@/domain/billing/pricing";
import { reminderDue, type Reminder } from "@/domain/billing/trial";
import { LOCALES, fmt, type Locale } from "@/lib/i18n/config";
import type { Dict } from "@/lib/i18n/fr";
import { escapeHtml, type MailMessage, type MailResult } from "@/lib/mail";
import { euros, formatDate } from "@/lib/types";
import { dayOf, periodName } from "./format";
import { APP, META, subscriptionView, type SubscriptionView } from "./service";

/**
 * The trial's e-mails, sent once a day by the cron route: seven days before
 * the first charge (as card schemes ask of trials) and two days before (the
 * reminder the offer screen promises), each once. Every trial has a card on
 * file, so both announce the charge and how to cancel. Everything needed is
 * at Stripe (the subscription, its customer's address and language), so the
 * job reads no workspace data at all. A reminder is recorded on the
 * subscription once sent, so each goes out once.
 */

export interface ReminderMail { subject: string; text: string; html: string }

export function reminderMail(kind: Reminder, sub: SubscriptionView, d: Dict, locale: Locale, link: string): ReminderMail {
  const b = d.billing;
  const date = formatDate(dayOf(sub.trialEnd ?? sub.periodEnd ?? 0), locale);
  const values = { date, amount: euros(sub.charged, locale), period: periodName(b, sub.rhythm ?? DEFAULT_RHYTHM) };
  const subject = fmt(kind === "d2" ? b.mailD2Subject : b.mailCardSubject, values);
  const body = fmt(kind === "d2" ? b.mailD2Body : b.mailCardBody, values);
  const text = [d.mail.helloAnonymous, "", body, "", `${b.mailButton}: ${link}`, "", d.mail.signature, "", b.mailFoot].join("\n");
  const html = `<div style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1f2924;max-width:560px">
<p>${escapeHtml(d.mail.helloAnonymous)}</p>
<p>${escapeHtml(body)}</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#10505c;color:#fff;text-decoration:none;font-weight:600;padding:10px 16px;border-radius:12px">${escapeHtml(b.mailButton)}</a></p>
<p>${escapeHtml(d.mail.signature)}</p>
<p style="color:#5d6b64;font-size:13px">${escapeHtml(b.mailFoot)}</p>
</div>`;
  return { subject, text, html };
}

export interface ReminderDeps {
  send: (message: MailMessage) => Promise<MailResult>;
  dict: (locale: Locale) => Dict;
  /** The app's own address, links are built on it. */
  appUrl: string;
  /** How long one run may take; the platform cuts a function at sixty seconds. */
  budgetMs?: number;
  /** The time, for tests. */
  clock?: () => number;
}

export interface ReminderRun { checked: number; sent: number; failed: number; /** Left for the next run: the time this one may take was up. */ deferred: number }

/** The daily run answers within the platform's minute: past this, what is left waits for tomorrow's run. */
export const REMINDER_BUDGET_MS = 45_000;

const localeOf = (raw: string): Locale => ((LOCALES as readonly string[]).includes(raw) ? (raw as Locale) : "fr");

/** One pass over the web app's subscriptions in their trial. */
export async function sendTrialReminders(stripe: Stripe, now: number, deps: ReminderDeps): Promise<ReminderRun> {
  const run: ReminderRun = { checked: 0, sent: 0, failed: 0, deferred: 0 };
  const trials: { sub: SubscriptionView; customer: Stripe.Customer }[] = [];
  const query = `status:'trialing' AND metadata['${META.app}']:'${APP}'`;
  for await (const raw of stripe.subscriptions.search({ query, limit: 100, expand: ["data.customer"] })) {
    const customer = raw.customer && typeof raw.customer === "object" && !("deleted" in raw.customer && raw.customer.deleted) ? (raw.customer as Stripe.Customer) : null;
    if (customer) trials.push({ sub: subscriptionView(raw), customer });
  }
  const clock = deps.clock ?? Date.now;
  const startedAt = clock();
  // The trials nearest their first charge first: when the run's time is up, what waits is furthest from it.
  trials.sort((a, b) => (a.sub.trialEnd ?? 0) - (b.sub.trialEnd ?? 0));
  for (const { sub, customer } of trials) {
    // A run cut by the platform says nothing of what it left: this one stops by itself and counts it.
    if (clock() - startedAt > (deps.budgetMs ?? REMINDER_BUDGET_MS)) {
      run.deferred = trials.length - run.checked;
      break;
    }
    run.checked += 1;
    if (!customer.email) continue;
    try {
      const due = reminderDue({ now, subscription: sub }, sub.reminders);
      if (!due) continue;
      const locale = localeOf(customer.metadata?.[META.locale] ?? "fr");
      const mail = reminderMail(due, sub, deps.dict(locale), locale, `${deps.appUrl}/app/abonnement`);
      const result = await deps.send({ to: customer.email, ...mail });
      if (!result.sent) { run.failed += 1; continue; }
      // The note that this reminder went out is what stops tomorrow's run from
      // sending it again: when it does not land the first time, it is tried once more.
      const noted = { metadata: { [META.reminders]: [...sub.reminders, due].join(",") } };
      await stripe.subscriptions.update(sub.id, noted).catch(() => stripe.subscriptions.update(sub.id, noted));
      run.sent += 1;
    } catch (error) {
      run.failed += 1;
      console.error("billing reminder failed:", (error as { code?: string }).code ?? (error instanceof Error ? error.message.slice(0, 120) : "unknown"));
    }
  }
  return run;
}

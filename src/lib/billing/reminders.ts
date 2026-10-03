import "server-only";
import type Stripe from "stripe";
import { TRIAL_DAYS, TRIAL_EXTENSION_DAYS, DEFAULT_RHYTHM } from "@/domain/billing/plans";
import { DAY, billingState, reminderDue, type Reminder } from "@/domain/billing/trial";
import { LOCALES, fmt, type Locale } from "@/lib/i18n/config";
import type { Dict } from "@/lib/i18n/fr";
import { escapeHtml, type MailMessage, type MailResult } from "@/lib/mail";
import { euros, formatDate } from "@/lib/types";
import { dayOf, periodName, planName } from "./format";
import { APP, META, factsOf, snapshotOf, type BillingSnapshot } from "./service";

/**
 * The trial's e-mails, sent once a day by the cron route: a week before the
 * end, two days before, and once when a trial ends with nothing subscribed;
 * for a card on file, the first charge announced a week ahead (as card
 * schemes ask of trials). Everything needed is at Stripe (the customer's
 * address, language, trial and subscription), so the job reads no workspace
 * data at all. A reminder is recorded on the customer once sent, so each
 * goes out once.
 */

export interface ReminderMail { subject: string; text: string; html: string }

export function reminderMail(kind: Reminder, snapshot: BillingSnapshot, d: Dict, locale: Locale, link: string, now: number): ReminderMail {
  const b = d.billing;
  const state = billingState(factsOf(snapshot, now));
  const end = state.phase === "trial_card" && state.firstChargeAt ? state.firstChargeAt : snapshot.customer.trialEnd;
  const date = formatDate(dayOf(end), locale);
  let subject: string;
  let body: string;
  if (state.phase === "trial_card") {
    const sub = snapshot.subscription!;
    subject = fmt(b.mailCardSubject, { date });
    body = fmt(b.mailCardBody, {
      date, plan: planName(b, sub.plan ?? snapshot.customer.plan), amount: euros(sub.charged, locale), period: periodName(b, sub.rhythm ?? DEFAULT_RHYTHM),
    });
  } else if (kind === "ended") {
    subject = b.mailEndedSubject;
    body = b.mailEndedBody;
  } else if (kind === "d2") {
    subject = fmt(b.mailD2Subject, { date });
    body = fmt(b.mailD2Body, { date });
  } else {
    subject = fmt(b.mailD7Subject, { date });
    body = fmt(b.mailD7Body, { date });
  }
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
}

export interface ReminderRun { checked: number; sent: number; failed: number }

const localeOf = (raw: string): Locale => ((LOCALES as readonly string[]).includes(raw) ? (raw as Locale) : "fr");

/** One pass over the workspaces whose trial is recent enough to be reminded of. */
export async function sendTrialReminders(stripe: Stripe, now: number, deps: ReminderDeps): Promise<ReminderRun> {
  const since = now - (TRIAL_DAYS + TRIAL_EXTENSION_DAYS + 4) * DAY;
  // The oldest customer stands for its workspace, as everywhere else.
  const byOrg = new Map<string, Stripe.Customer>();
  for await (const customer of stripe.customers.search({ query: `metadata['${META.app}']:'${APP}' AND created>${since}`, limit: 100 })) {
    const org = customer.metadata?.[META.org];
    if (!org) continue;
    const held = byOrg.get(org);
    if (!held || customer.created < held.created) byOrg.set(org, customer);
  }
  const run: ReminderRun = { checked: 0, sent: 0, failed: 0 };
  for (const customer of byOrg.values()) {
    run.checked += 1;
    if (!customer.email) continue;
    try {
      const snapshot = await snapshotOf(stripe, customer);
      const due = reminderDue(factsOf(snapshot, now), snapshot.customer.reminders);
      if (!due) continue;
      const locale = localeOf(snapshot.customer.locale);
      const mail = reminderMail(due, snapshot, deps.dict(locale), locale, `${deps.appUrl}/app/abonnement`, now);
      const result = await deps.send({ to: customer.email, ...mail });
      if (!result.sent) { run.failed += 1; continue; }
      await stripe.customers.update(customer.id, { metadata: { [META.reminders]: [...snapshot.customer.reminders, due].join(",") } });
      run.sent += 1;
    } catch (error) {
      run.failed += 1;
      console.error("billing reminder failed:", (error as { code?: string }).code ?? (error instanceof Error ? error.message.slice(0, 120) : "unknown"));
    }
  }
  return run;
}

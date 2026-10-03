import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getDict } from "@/lib/i18n";
import { sendMail } from "@/lib/mail";
import { APP_URL } from "@/lib/constants";
import { stripeClient } from "@/lib/billing/stripe";
import { sendTrialReminders } from "@/lib/billing/reminders";
import { stepLoyalty } from "@/lib/billing/service";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The daily run, called by Vercel Cron (vercel.json): the trial reminders,
 * then the loyalty years of the subscriptions priced here, each on its own
 * so one failing leaves the other to run. Vercel sends the project's
 * CRON_SECRET as a bearer token; without that variable the route does
 * nothing, so a deployment that should not mail (the preview project)
 * simply leaves it unset.
 */
function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const stripe = stripeClient();
  if (!stripe) return NextResponse.json({ skipped: "not_configured" });
  const now = Math.floor(Date.now() / 1000);
  const [reminders, loyalty] = await Promise.allSettled([
    sendTrialReminders(stripe, now, { send: sendMail, dict: getDict, appUrl: APP_URL }),
    stepLoyalty(stripe, now),
  ]);
  if (reminders.status === "rejected") console.error("billing reminders failed:", (reminders.reason as { code?: string })?.code ?? "unknown");
  if (loyalty.status === "rejected") console.error("billing loyalty failed:", (loyalty.reason as { code?: string })?.code ?? "unknown");
  const body = {
    reminders: reminders.status === "fulfilled" ? reminders.value : { error: "unavailable" },
    loyalty: loyalty.status === "fulfilled" ? loyalty.value : { error: "unavailable" },
  };
  return NextResponse.json(body, { status: reminders.status === "rejected" && loyalty.status === "rejected" ? 502 : 200 });
}

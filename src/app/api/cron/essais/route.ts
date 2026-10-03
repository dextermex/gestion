import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getDict } from "@/lib/i18n";
import { sendMail } from "@/lib/mail";
import { APP_URL } from "@/lib/constants";
import { stripeClient } from "@/lib/billing/stripe";
import { sendTrialReminders } from "@/lib/billing/reminders";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The daily trial reminders, called by Vercel Cron (vercel.json). Vercel
 * sends the project's CRON_SECRET as a bearer token; without that variable
 * the route does nothing, so a deployment that should not mail (the preview
 * project) simply leaves it unset.
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
  try {
    const run = await sendTrialReminders(stripe, Math.floor(Date.now() / 1000), { send: sendMail, dict: getDict, appUrl: APP_URL });
    return NextResponse.json(run);
  } catch (error) {
    console.error("billing reminders failed:", (error as { code?: string }).code ?? "unknown");
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}

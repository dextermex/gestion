import { getI18n } from "@/lib/i18n";
import { getDemo, isSampleData } from "@/lib/demo";
import { getIdentity } from "@/lib/workspace";
import { getSession } from "@/lib/supabase/server";
import { PageHeader } from "@/components/pro/ui";
import BillingPanel from "@/components/gestion/BillingPanel";
import { TRIAL_DAYS, billedRents } from "@/domain/billing/pricing";
import { DAY, billingState } from "@/domain/billing/trial";
import { billingPhaseMeta } from "@/lib/types";
import { billingPage, type BillingPageData } from "@/lib/billing/view";

/**
 * Abonnement: how to be billed, the price, the card and the invoices. The
 * figures are the published pricing's (src/domain/billing/pricing.ts) over
 * the rents of the lots the account's own rows let; the subscription itself
 * is read from Stripe (src/lib/billing). On a sample cabinet, the cabinet's
 * sample trial.
 */
export default async function SubscriptionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale, d } = await getI18n();
  const params = await searchParams;
  const [demo, sample] = await Promise.all([getDemo({ shell: true }), isSampleData()]);
  const rents = billedRents(demo.UNITS, demo.LEASES);
  const now = Math.floor(Date.now() / 1000);

  let data: BillingPageData;
  if (sample) {
    const trialEnd = now + (TRIAL_DAYS - demo.BILLING.trialDay) * DAY;
    data = {
      status: "ready", mode: null, canManage: true, rhythm: demo.BILLING.rhythm, year: 1, trialEnd, canExtend: false,
      state: billingState({ now, trialEnd, subscription: null }), subscription: null,
    };
  } else {
    const [identity, session] = await Promise.all([getIdentity(), getSession()]);
    const org = identity?.active;
    data = !org || !session
      ? { status: "off", mode: null, canManage: false, rhythm: "quarter", year: 1, trialEnd: null, canExtend: false, state: null, subscription: null }
      : await billingPage({ org, userId: session.userId, email: session.email, locale, metadata: session.metadata }, now);
  }

  const badge = data.state ? billingPhaseMeta(d)[data.state.phase] : null;
  return (
    <>
      <PageHeader title={d.billing.title} subtitle={d.billing.subtitle} />
      <BillingPanel locale={locale} b={d.billing} data={data} rents={rents} sample={sample} now={now} badge={badge} confirmed={params.confirme === "1"} />
    </>
  );
}

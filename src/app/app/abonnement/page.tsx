import { getI18n } from "@/lib/i18n";
import { getDemo, isSampleData } from "@/lib/demo";
import { getIdentity } from "@/lib/workspace";
import { getSession } from "@/lib/supabase/server";
import { PageHeader } from "@/components/pro/ui";
import BillingPanel from "@/components/gestion/BillingPanel";
import { TRIAL_DAYS, billedLots } from "@/domain/billing/plans";
import { DAY, billingState } from "@/domain/billing/trial";
import { billingPhaseMeta } from "@/lib/types";
import { billingPage, memberCount, type BillingPageData } from "@/lib/billing/view";

/**
 * Abonnement: the plan, the rhythm, the card and the invoices. The figures
 * are the catalogue's (src/domain/billing/plans.ts) over the lots the
 * account's own rows count; the subscription itself is read from Stripe
 * (src/lib/billing). On a sample cabinet, the cabinet's sample trial.
 */
export default async function SubscriptionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale, d } = await getI18n();
  const params = await searchParams;
  const [demo, sample] = await Promise.all([getDemo({ shell: true }), isSampleData()]);
  const lots = billedLots(demo.UNITS);
  const now = Math.floor(Date.now() / 1000);

  let data: BillingPageData;
  let seats: number;
  if (sample) {
    const trialEnd = now + (TRIAL_DAYS - demo.BILLING.trialDay) * DAY;
    data = {
      status: "ready", mode: null, canManage: true, plan: demo.BILLING.plan, rhythm: demo.BILLING.rhythm, trialEnd, canExtend: false,
      state: billingState({ now, trialEnd, subscription: null }), subscription: null,
    };
    seats = demo.BILLING.seats;
  } else {
    const [identity, session] = await Promise.all([getIdentity(), getSession()]);
    const org = identity?.active;
    if (!org || !session) {
      data = { status: "off", mode: null, canManage: false, plan: "landlord", rhythm: "quarter", trialEnd: null, canExtend: false, state: null, subscription: null };
      seats = 1;
    } else {
      [data, seats] = await Promise.all([
        billingPage({ org, userId: session.userId, email: session.email, locale, metadata: session.metadata }, now),
        memberCount(session.accessToken, org.id),
      ]);
    }
  }

  const badge = data.state ? billingPhaseMeta(d)[data.state.phase] : null;
  return (
    <>
      <PageHeader title={d.billing.title} subtitle={d.billing.subtitle} />
      <BillingPanel locale={locale} b={d.billing} data={data} lots={lots} seats={seats} sample={sample} now={now} badge={badge} confirmed={params.confirme === "1"} />
    </>
  );
}

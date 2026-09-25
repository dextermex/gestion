import { Badge, Card } from "@/components/pro/ui";
import { MetaBadge } from "@/components/gestion/bits";
import TenantEmpty from "@/components/gestion/TenantEmpty";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { getTenantView } from "@/lib/portal/space";
import { paymentsOf, type TenantPeriod } from "@/lib/portal/tenant-space";
import { euros, formatDate, formatMonth, rentStatusMeta, type Meta } from "@/lib/types";

/**
 * "Paiements": the ledger as the tenant may read it. What is due now and
 * by when, how it breaks down, what has arrived against it, what is still
 * owed from before, and every month so far. Paid-ness is what the
 * allocations say, on both sides of the product.
 */
export default async function TenantPaymentsPage() {
  const { locale, d } = await getI18n();
  const view = await getTenantView();
  if (view.kind === "signed_out") return null;
  const { space } = view;
  const lease = space.current ?? space.past[0];
  if (!lease) return <TenantEmpty d={d} manage={view.canManage} />;
  const ended = space.current === null;
  const pay = space.payments ?? paymentsOf(lease, space.today);
  const rentMeta = rentStatusMeta(d) as Record<string, Meta>;
  const metaOf = (status: string): Meta => rentMeta[status] ?? rentMeta[status === "partial_late" ? "late" : "pending"];
  const current: TenantPeriod | null = ended
    ? null
    : pay.thisMonth ?? pay.history.find((p) => p.dueDate === pay.nextDueOn) ?? null;
  const receipts = new Map(lease.documents.filter((doc) => doc.klass === "receipt").map((doc) => [doc.name, doc]));

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{d.tenant.payTitle}</h1>
        <p className="mt-1 text-sm text-ink-soft">{d.tenant.paySub}</p>
      </div>

      {!ended && (
        <Card className="mb-5 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.tenant.payCurrentTitle}</p>
          {current ? (
            <div className="mt-2 grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div>
                <p className="font-display text-3xl font-bold tracking-tight tabular-nums text-ink">{euros(current.totalCents - current.allocatedCents, locale)}</p>
                <p className="text-sm text-ink-soft">
                  {formatMonth(current.period, locale)} · {fmt(d.tenant.payDueOn, { date: formatDate(current.dueDate, locale) })}
                </p>
                <div className="mt-2">
                  <MetaBadge meta={metaOf(current.status)} />
                </div>
                {lease.rfReference && (
                  <>
                    <p className="mt-4 text-[11px] font-semibold text-ink-soft">{d.tenant.payRef}</p>
                    <code className="mt-1 inline-block rounded-md bg-sand-50 px-2 py-1 text-xs font-semibold tabular-nums text-brand-800">{lease.rfReference}</code>
                  </>
                )}
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.tenant.payBreakdown}</p>
                <dl className="mt-1 divide-y divide-sand-100 text-sm">
                  {[
                    [d.tenant.payRentLine, current.rentCents],
                    [d.tenant.payChargesLine, current.chargesCents],
                    [d.tenant.payOtherLine, current.otherCents],
                    [d.tenant.payVatLine, current.vatCents],
                  ]
                    .filter(([, cents]) => (cents as number) > 0)
                    .map(([label, cents]) => (
                      <div key={label as string} className="flex justify-between gap-3 py-1.5">
                        <dt className="text-ink-soft">{label}</dt>
                        <dd className="tabular-nums text-ink">{euros(cents as number, locale)}</dd>
                      </div>
                    ))}
                  <div className="flex justify-between gap-3 py-1.5">
                    <dt className="text-ink-soft">{d.tenant.payPaidLine}</dt>
                    <dd className="tabular-nums text-ink">{euros(current.allocatedCents, locale)}</dd>
                  </div>
                  <div className="flex justify-between gap-3 py-1.5 font-semibold">
                    <dt className="text-ink">{d.tenant.payRemainingLine}</dt>
                    <dd className="tabular-nums text-ink">{euros(current.totalCents - current.allocatedCents, locale)}</dd>
                  </div>
                </dl>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink-soft">{d.tenant.payNoCurrent}</p>
          )}
        </Card>
      )}

      {!ended && (
        <Card className="mb-5 p-5" data-pay-instructions>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.tenant.payInstructions}</p>
          {space.paymentInstructions ? (
            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
              <dt className="text-ink-soft">{d.tenant.payHolder}</dt>
              <dd className="font-semibold text-ink">{space.paymentInstructions.holderName}</dd>
              <dt className="text-ink-soft">{d.tenant.payIban}</dt>
              <dd>
                <code className="rounded-md bg-sand-50 px-2 py-1 text-xs font-semibold tabular-nums text-brand-800" data-pay-iban>
                  {space.paymentInstructions.iban.replace(/(.{4})/g, "$1 ").trim()}
                </code>
              </dd>
              {space.paymentInstructions.bic && (
                <>
                  <dt className="text-ink-soft">{d.tenant.payBic}</dt>
                  <dd className="tabular-nums text-ink">{space.paymentInstructions.bic}</dd>
                </>
              )}
              {lease.rfReference && (
                <>
                  <dt className="text-ink-soft">{d.tenant.payRef}</dt>
                  <dd className="tabular-nums text-ink">{lease.rfReference}</dd>
                </>
              )}
            </dl>
          ) : (
            <p className="mt-2 text-sm text-ink-soft">{d.tenant.payNoInstructions}</p>
          )}
        </Card>
      )}

      {pay.outstandingCents > 0 && (
        <div role="alert" className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-5">
          <p className="font-display text-base font-bold text-red-800">{d.tenant.payOutstandingTitle}</p>
          <p className="mt-1 text-sm text-red-800">{fmt(d.tenant.payOutstandingBody, { amount: euros(pay.outstandingCents, locale) })}</p>
        </div>
      )}

      <h2 className="mb-3 font-display text-lg font-bold text-ink">{d.tenant.payHistory}</h2>
      <Card className="overflow-hidden">
        {pay.history.length === 0 ? (
          <p className="p-5 text-sm text-ink-soft">{d.tenant.payNone}</p>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                  <th className="px-4 py-2.5 font-semibold">{d.tenant.payMonth}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{d.tenant.payAmount}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{d.tenant.payStatus}</th>
                  <th className="px-4 py-2.5 text-right font-semibold">{d.tenant.payReceipt}</th>
                </tr>
              </thead>
              <tbody>
                {pay.history.map((rp) => {
                  const receipt = [...receipts.values()].find((doc) => doc.name.includes(rp.period)) ?? null;
                  return (
                    <tr key={rp.id} className="border-b border-sand-50 last:border-0">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-ink">{formatMonth(rp.period, locale)}</p>
                        <p className="text-xs text-ink-soft">{formatDate(rp.dueDate, locale)}</p>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink">
                        {euros(rp.totalCents, locale)}
                        {rp.allocatedCents > 0 && rp.allocatedCents < rp.totalCents && (
                          <p className="text-xs text-ink-soft">{`${d.tenant.payPaidLine} ${euros(rp.allocatedCents, locale)}`}</p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <MetaBadge meta={metaOf(rp.status)} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {receipt?.url ? (
                          <a href={receipt.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand-700 hover:underline max-sm:inline-flex max-sm:min-h-10 max-sm:items-center">
                            {d.tenant.receiptDownload}
                          </a>
                        ) : rp.status === "paid" ? (
                          <span className="text-xs text-ink-soft">{d.common.none}</span>
                        ) : (
                          <Badge>{d.tenant.receiptSoon}</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

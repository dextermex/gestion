import Link from "next/link";
import CopyButton from "@/components/gestion/CopyButton";
import { Badge, Card } from "@/components/pro/ui";
import { MetaBadge } from "@/components/gestion/bits";
import TenantEmpty from "@/components/gestion/TenantEmpty";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { getTenantView } from "@/lib/portal/space";
import { paymentsOf, type TenantPeriod } from "@/lib/portal/tenant-space";
import { rentDue } from "@/lib/portal/view";
import { euros, formatDate, formatMonth, rentStatusMeta, type Meta } from "@/lib/types";

/**
 * "Paiements": the ledger as the tenant may read it. What is owed now and
 * why, in the words the home uses; else what falls due next and how it
 * breaks down; where to pay, each value one press from the clipboard; and
 * every month so far with its receipt, or the way to ask for one. Paid-ness
 * is what the allocations say, on both sides of the product.
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
  const due = rentDue(lease, space.today);
  const owed = !ended && due.lateCents > 0;
  const onlyLate = due.latePeriods.length === 1 ? due.latePeriods[0] : null;
  const rentMeta = rentStatusMeta(d) as Record<string, Meta>;
  const metaOf = (status: string): Meta => rentMeta[status] ?? rentMeta[status === "partial_late" ? "late" : "pending"];
  const current: TenantPeriod | null = ended
    ? null
    : pay.thisMonth ?? pay.history.find((p) => p.dueDate === pay.nextDueOn) ?? null;
  // The period whose lines the summary breaks down: the single late one when rent is owed, else the current one.
  const detailed: TenantPeriod | null = owed ? onlyLate : current;
  const receipts = new Map(lease.documents.filter((doc) => doc.klass === "receipt").map((doc) => [doc.name, doc]));
  const instructions = space.paymentInstructions;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{d.tenant.payTitle}</h1>
        <p className="mt-1 text-sm text-ink-soft">{d.tenant.paySub}</p>
      </div>

      {!ended && (
        <Card className="tenant-payment-summary mb-5 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{owed ? d.tenant.dueNowTitle : d.tenant.payCurrentTitle}</p>
          {owed || current ? (
            <div className="mt-2 grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div>
                {owed ? (
                  <>
                    <p className="font-display text-3xl font-bold tracking-tight tabular-nums text-ink">{euros(due.lateCents, locale)}</p>
                    <p className="text-sm text-ink-soft">
                      {onlyLate
                        ? onlyLate.allocatedCents > 0
                          ? fmt(d.tenant.dueOne, { month: formatMonth(onlyLate.period, locale), paid: euros(onlyLate.allocatedCents, locale), total: euros(onlyLate.totalCents, locale) })
                          : fmt(d.tenant.dueOneUnpaid, { month: formatMonth(onlyLate.period, locale), date: formatDate(onlyLate.dueDate, locale) })
                        : fmt(d.tenant.dueMany, { n: due.latePeriods.length })}
                    </p>
                    <div className="mt-2">
                      <Badge className="bg-red-100 text-red-700">{d.tenant.rentLate}</Badge>
                    </div>
                    {pay.nextDueOn && (
                      <p className="mt-4 text-sm text-ink-soft">
                        {d.tenant.payNextTitle} : <span className="font-semibold tabular-nums text-ink">{fmt(d.tenant.nextRentLine, { amount: euros(pay.nextDueCents, locale), date: formatDate(pay.nextDueOn, locale) })}</span>
                      </p>
                    )}
                  </>
                ) : current ? (
                  <>
                    <p className="font-display text-3xl font-bold tracking-tight tabular-nums text-ink">{euros(current.totalCents - current.allocatedCents, locale)}</p>
                    <p className="text-sm text-ink-soft">
                      {formatMonth(current.period, locale)} · {fmt(d.tenant.payDueOn, { date: formatDate(current.dueDate, locale) })}
                    </p>
                    <div className="mt-2">
                      <MetaBadge meta={metaOf(current.status)} />
                    </div>
                  </>
                ) : null}
              </div>
              <div>
                {detailed ? (
                  <>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.tenant.payBreakdown}</p>
                    <dl className="mt-1 divide-y divide-sand-100 text-sm">
                      {[
                        [d.tenant.payRentLine, detailed.rentCents],
                        [d.tenant.payChargesLine, detailed.chargesCents],
                        [d.tenant.payOtherLine, detailed.otherCents],
                        [d.tenant.payVatLine, detailed.vatCents],
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
                        <dd className="tabular-nums text-ink">{euros(detailed.allocatedCents, locale)}</dd>
                      </div>
                      <div className="flex justify-between gap-3 py-1.5 font-semibold">
                        <dt className="text-ink">{d.tenant.payRemainingLine}</dt>
                        <dd className="tabular-nums text-ink">{euros(detailed.totalCents - detailed.allocatedCents, locale)}</dd>
                      </div>
                    </dl>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.tenant.payLateTitle}</p>
                    <dl className="mt-1 divide-y divide-sand-100 text-sm">
                      {due.latePeriods.map((p) => (
                        <div key={p.id} className="flex justify-between gap-3 py-1.5">
                          <dt className="text-ink-soft">{formatMonth(p.period, locale)}</dt>
                          <dd className="tabular-nums text-ink">{euros(p.totalCents - p.allocatedCents, locale)}</dd>
                        </div>
                      ))}
                    </dl>
                  </>
                )}
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
          {instructions ? (
            <dl className="tenant-pay-lines mt-2 text-sm">
              <div>
                <dt>{d.tenant.payHolder}</dt>
                <dd className="font-semibold text-ink">{instructions.holderName}</dd>
              </div>
              <div>
                <dt>{d.tenant.payIban}</dt>
                <dd className="font-mono text-sm font-semibold tabular-nums text-brand-800" data-pay-iban>
                  {instructions.iban.replace(/(.{4})/g, "$1 ").trim()}
                </dd>
                <CopyButton value={instructions.iban} label={d.tenant.copy} copiedLabel={d.tenant.copied} ariaLabel={fmt(d.tenant.copyAria, { what: d.tenant.payIban })} />
              </div>
              {instructions.bic && (
                <div>
                  <dt>{d.tenant.payBic}</dt>
                  <dd className="tabular-nums text-ink">{instructions.bic}</dd>
                </div>
              )}
              {lease.rfReference && (
                <div>
                  <dt>{d.tenant.payRefShort}</dt>
                  <dd className="font-mono text-sm font-semibold tabular-nums text-brand-800">{lease.rfReference}</dd>
                  <CopyButton value={lease.rfReference} label={d.tenant.copy} copiedLabel={d.tenant.copied} ariaLabel={fmt(d.tenant.copyAria, { what: d.tenant.payRefShort })} />
                </div>
              )}
            </dl>
          ) : (
            <p className="mt-2 text-sm text-ink-soft">{d.tenant.payNoInstructions}</p>
          )}
        </Card>
      )}

      {owed && due.staleOrder && (
        <div className="mb-6 rounded-2xl bg-amber-50 p-5 text-sm leading-relaxed text-amber-900">
          <p className="font-display text-base font-bold">{fmt(d.tenant.payWhyTitle, { amount: euros(due.lateCents, locale) })}</p>
          <p className="mt-1">
            {lease.lastAdjustmentOn && lease.previousRentCents !== null
              ? fmt(d.tenant.payWhyBody, { date: formatDate(lease.lastAdjustmentOn, locale), old: euros(lease.previousRentCents, locale), new: euros(lease.rentCents, locale), total: euros(due.staleOrder.dueCents, locale) })
              : fmt(d.tenant.payWhyBodyShort, { total: euros(due.staleOrder.dueCents, locale) })}
          </p>
        </div>
      )}

      <h2 className="mb-3 font-display text-lg font-bold text-ink">{d.tenant.payHistory}</h2>
      <Card className="overflow-hidden">
        {pay.history.length === 0 ? (
          <p className="p-5 text-sm text-ink-soft">{d.tenant.payNone}</p>
        ) : (
          <div className="table-scroll table-fold">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                  <th className="px-4 py-2.5 font-semibold">{d.tenant.payMonth}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{d.tenant.payAmount}</th>
                  <th className="px-3 py-2.5 text-right font-semibold max-sm:hidden">{d.tenant.payStatus}</th>
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
                        <span className="mt-1 inline-flex sm:hidden">
                          <MetaBadge meta={metaOf(rp.status)} />
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink">
                        {euros(rp.totalCents, locale)}
                        {rp.allocatedCents > 0 && rp.allocatedCents < rp.totalCents && (
                          <p className="text-xs text-ink-soft">{`${d.tenant.payPaidLine} ${euros(rp.allocatedCents, locale)}`}</p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right max-sm:hidden">
                        <MetaBadge meta={metaOf(rp.status)} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {receipt?.url ? (
                          <a href={receipt.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 hover:underline">
                            {d.tenant.receiptDownload}
                          </a>
                        ) : rp.status === "paid" ? (
                          // Paid, and no receipt on file: said plainly, with the way to ask while the tenancy runs.
                          <span className="inline-flex flex-col items-end">
                            <span className="text-xs text-ink-soft">{d.tenant.receiptNone}</span>
                            {!ended && (
                              <Link href={`/locataire/demandes?nouvelle=quittance&mois=${encodeURIComponent(rp.period)}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 underline underline-offset-4 hover:no-underline">
                                {d.tenant.receiptAsk}
                              </Link>
                            )}
                          </span>
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

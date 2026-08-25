import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/pro/ui";
import { LegalNote, MetaBadge, Panel } from "@/components/gestion/bits";
import { ReviewQueue } from "@/components/gestion/ReviewQueue";
import { DemoAction } from "@/components/gestion/DemoAction";
import { getDemo } from "@/lib/demo";
import { bankTxStatusMeta, euros, formatDate, formatPct, matchTierMeta } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { diffDays } from "@/domain/dates";
import { vopNameCheck } from "@/domain/banking/rf";

export default async function BanquePage({
  searchParams,
}: {
  searchParams: Promise<{ vue?: string }>;
}) {
  const params = await searchParams;
  const { locale, d } = await getI18n();
  const { BANK_ACCOUNTS, BANK_TXS, TODAY } = await getDemo();
  const txMeta = bankTxStatusMeta(d);
  const tierMeta = matchTierMeta(d);

  const autoCount = BANK_TXS.filter((t) => t.status === "auto").length;
  const inCount = BANK_TXS.filter((t) => t.amount > 0).length;
  const autoRate = Math.round((100 * autoCount) / inCount);
  const review = BANK_TXS.filter((t) => t.status === "review");

  // Transaction views — the immocloud tab pills, URL-driven.
  const views = [
    { slug: undefined, label: d.banque.viewAll, count: BANK_TXS.length },
    { slug: "averifier", label: d.banque.viewReview, count: review.length },
    { slug: "auto", label: d.banque.viewAuto, count: BANK_TXS.filter((t) => t.status === "auto" || t.status === "manual").length },
    { slug: "ignorees", label: d.banque.viewIgnored, count: BANK_TXS.filter((t) => t.status === "ignored").length },
  ] as const;
  const vue = views.some((v) => v.slug === params.vue) ? params.vue : undefined;
  const txRows =
    vue === "averifier"
      ? review
      : vue === "auto"
        ? BANK_TXS.filter((t) => t.status === "auto" || t.status === "manual")
        : vue === "ignorees"
          ? BANK_TXS.filter((t) => t.status === "ignored")
          : BANK_TXS;

  const cascade: Array<[string, string]> = [
    [d.banque.cascade0, d.banque.cascade0Body],
    [d.banque.cascade1, d.banque.cascade1Body],
    [d.banque.cascade2, d.banque.cascade2Body],
    [d.banque.cascade3, d.banque.cascade3Body],
  ];

  return (
    <div>
      <PageHeader title={d.banque.title} subtitle={d.banque.subtitle} />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.banque.kpiAuto}</p>
          <p
            className={
              "mt-1 font-display text-2xl font-bold tracking-tight tabular-nums " +
              (autoRate >= 90 ? "text-emerald-700" : "text-amber-700")
            }
          >
            {formatPct(autoRate, locale)}
          </p>
          <p className="mt-0.5 text-xs text-ink-soft">{d.banque.kpiAutoSub}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.banque.kpiReview}</p>
          <p className="mt-1 font-display text-2xl font-bold tracking-tight tabular-nums text-ink">{review.length}</p>
          <p className="mt-0.5 text-xs text-ink-soft">{d.banque.kpiReviewSub}</p>
        </Card>
        {BANK_ACCOUNTS.map((b) => (
          <Card key={b.id} className="p-4">
            <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-ink-soft" title={b.label}>
              {b.label}
            </p>
            <p className="mt-1 font-display text-2xl font-bold tracking-tight tabular-nums text-ink">
              {euros(b.balanceCents, locale)}
            </p>
            {b.consentExpiresAt ? (
              <p
                className={
                  "mt-0.5 text-xs " +
                  (diffDays(TODAY, b.consentExpiresAt) <= 21 ? "font-semibold text-amber-700" : "text-ink-soft")
                }
              >
                {fmt(d.banque.consentExpires, {
                  date: formatDate(b.consentExpiresAt, locale),
                  days: diffDays(TODAY, b.consentExpiresAt),
                })}
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-ink-soft">{d.banque.accountCamt}</p>
            )}
          </Card>
        ))}
        {/* Connect a new account — the calm dashed slot, PSD2 read-only */}
        <Card className="flex flex-col items-start justify-between border-dashed bg-sand-50/50 p-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              {d.banque.accountsTitle}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">{d.banque.connectBody}</p>
          </div>
          <DemoAction label={`+ ${d.banque.connectAccount}`} doneMessage={d.banque.connectDone} className="mt-3" />
        </Card>
      </div>

      {review.length > 0 && (
        <Panel title={d.banque.reviewTitle} className="mb-5">
          <ReviewQueue
            rows={review.map((t) => ({
              id: t.id,
              counterparty: t.counterpartyName ?? "—",
              amountLabel: euros(t.amount, locale),
              remittance: t.remittanceInfo ?? "—",
              dateLabel: formatDate(t.bookedAt, locale),
              explain: t.matchExplain ?? "",
            }))}
            labels={{
              match: d.banque.reviewMatch,
              ignore: d.banque.reviewIgnore,
              matched: d.banque.reviewMatched,
              ignored: d.banque.reviewIgnored,
            }}
          />
          <LegalNote>{d.banque.reviewLegal}</LegalNote>
        </Panel>
      )}

      {/* Status pills + refresh — the immocloud banking toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {views.map((v) => (
            <Link
              key={v.label}
              href={v.slug ? `/app/banque?vue=${v.slug}` : "/app/banque"}
              aria-current={vue === v.slug ? "page" : undefined}
              className={
                "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition max-sm:min-h-11 " +
                (vue === v.slug
                  ? "bg-brand-600 text-white"
                  : "border border-sand-200 bg-white text-ink-soft hover:border-brand-200 hover:text-brand-700")
              }
            >
              {v.label}
              <span
                className={
                  "flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums " +
                  (vue === v.slug ? "bg-white/20 text-white" : "bg-sand-100 text-ink-soft")
                }
              >
                {v.count}
              </span>
            </Link>
          ))}
        </div>
        <div className="ml-auto">
          <DemoAction label={d.banque.retrieve} doneMessage={d.banque.retrieveDone} variant="secondary" />
        </div>
      </div>

      {txRows.length === 0 ? (
        <EmptyState
          title={d.banque.emptyTitle}
          body={d.banque.emptyBody}
          action={
            <Link href="/app/banque" className="text-sm font-semibold text-brand-700 hover:underline">
              {d.common.resetFilters}
            </Link>
          }
        />
      ) : (
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                <th className="px-4 py-2.5 font-semibold">{d.banque.colCounterparty}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{d.banque.colAmount}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{d.banque.colDate}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{d.banque.colTier}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{d.banque.colStatus}</th>
              </tr>
            </thead>
            <tbody>
              {txRows.map((t) => (
                <tr key={t.id} className="border-b border-sand-50 last:border-0 hover:bg-sand-50/50">
                  <td className="max-w-md px-4 py-3">
                    <p className="font-semibold text-ink">{t.counterpartyName}</p>
                    <p className="truncate text-xs text-ink-soft" title={t.matchExplain}>
                      « {t.remittanceInfo} »
                    </p>
                  </td>
                  <td className={"px-3 py-3 text-right tabular-nums " + (t.amount < 0 ? "text-ink-soft" : "text-ink")}>
                    {euros(t.amount, locale)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-soft">{formatDate(t.bookedAt, locale)}</td>
                  <td className="px-3 py-3 text-right">
                    {t.matchTier ? (
                      <MetaBadge meta={tierMeta[t.matchTier]} />
                    ) : (
                      <span className="text-xs text-ink-soft">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <MetaBadge meta={txMeta[t.status]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title={d.banque.cascadeTitle}>
          <ol className="space-y-3 text-sm">
            {cascade.map(([title, body], i) => (
              <li key={title} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">
                  {i}
                </span>
                <div>
                  <p className="font-semibold text-ink">{title}</p>
                  <p className="text-xs leading-relaxed text-ink-soft">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title={d.banque.vopTitle}>
          {BANK_ACCOUNTS.map((b) => {
            const check = vopNameCheck(b.holderNameVerbatim, b.holderNameVerbatim);
            return (
              <div key={b.id} className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-sand-200 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold tabular-nums text-ink">{b.iban}</p>
                  <p className="truncate text-xs text-ink-soft">
                    {fmt(d.banque.vopChecked, { name: b.holderNameVerbatim })}
                  </p>
                </div>
                <Badge className={check.ok ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}>
                  {check.ok ? d.banque.vopOk : d.banque.vopMismatch}
                </Badge>
              </div>
            );
          })}
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50/40 p-3">
            <p className="min-w-0 text-xs leading-relaxed text-ink-soft">{d.banque.vopExample}</p>
            <Badge className="bg-red-100 text-red-700">{d.banque.vopMismatch}</Badge>
          </div>
          <LegalNote>{d.banque.vopLegal}</LegalNote>
        </Panel>
      </div>
    </div>
  );
}

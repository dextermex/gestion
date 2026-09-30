import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import { CollapsiblePanel, LegalNote } from "@/components/gestion/bits";
import { DemoAction } from "@/components/gestion/DemoAction";
import BankImport from "@/components/gestion/BankImport";
import BankWorkspace, { type WorkspaceLabels, type TxRow } from "@/components/gestion/BankWorkspace";
import { isBankView } from "@/lib/banking/views";
import type { LeaseOption, ReviewRow } from "@/components/gestion/ReviewQueue";
import SaltEdgeConnect from "@/components/gestion/SaltEdgeConnect";
import SyncBank from "@/components/gestion/SyncBank";
import { connectLabels, syncLabels } from "@/lib/banking/labels";
import { SaltEdgeError, demoSnapshot, saltEdgeConfigured, type DemoSnapshot } from "@/lib/banking/saltedge";
import { getSession } from "@/lib/supabase/server";
import { getDatasetId, getDemo } from "@/lib/demo";
import { bankTxStatusMeta, euros, formatDate, formatPct, matchTierMeta } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import type { BankTxStatus } from "@/lib/types";
import type { DemoBankTx } from "@/lib/demo/data";
import { diffDays } from "@/domain/dates";
import { scoreFuzzy } from "@/domain/banking/matching";
import { vopNameCheck } from "@/domain/banking/rf";

/**
 * Back from the sample cabinet's demonstration journey: what Salt Edge's fake
 * bank answered for the signed-in account's demo customer, read live and
 * stored nowhere. A failed read is logged and shows nothing, never a sample.
 */
async function readDemoSnapshot(): Promise<DemoSnapshot | null> {
  const session = await getSession();
  if (!session) return null;
  try {
    return await demoSnapshot(`morada-demo-${session.userId}`);
  } catch (e) {
    console.error("saltedge demo read failed:", e instanceof SaltEdgeError ? `${e.code}: ${e.message}` : e);
    return null;
  }
}

/**
 * Banking. The balance leads, with the two figures that say how the
 * reconciliation is doing beside it; then the decisions waiting on the
 * manager, then every operation. A real account with no bank connection
 * gets one honest empty state, never a sample balance.
 */
export default async function BanquePage({
  searchParams,
}: {
  searchParams: Promise<{ connexion?: string; vue?: string }>;
}) {
  const params = await searchParams;
  const { locale, d } = await getI18n();
  const [{ BANK_ACCOUNTS, BANK_TXS, IBAN_BINDINGS, LEASES, ORG, TODAY, leaseTenantNames, leaseUnitLabel, openInvoicesForMatching }, datasetId] = await Promise.all([getDemo(), getDatasetId()]);

  // Real accounts get the real consent journey. A sample cabinet gets the
  // same journey on Salt Edge's fake bank when the deployment carries the
  // credentials (a demonstration: nothing of it is stored), and the demo
  // action when it does not.
  const real = datasetId === "real";
  const liveJourney = real || saltEdgeConfigured();
  const connectCta = liveJourney ? (
    <SaltEdgeConnect label={d.banque.connectAccount} labels={connectLabels(d)} hint={real ? undefined : d.banque.connectDemo} />
  ) : (
    <DemoAction label={`+ ${d.banque.connectAccount}`} doneMessage={d.banque.connectDone} />
  );
  // Back from the demonstration journey: what the fake bank answered, live.
  const demoRead = !real && liveJourney && params.connexion === "demo" ? await readDemoSnapshot() : null;
  const demoOps = demoRead ? demoRead.accounts.reduce((n, a) => n + a.transactions, 0) : 0;
  const money = (amount: number, currency: string): string =>
    currency === "EUR" ? euros(Math.round(amount * 100), locale) : `${amount.toFixed(2)} ${currency}`;
  const txMeta = bankTxStatusMeta(d);
  const tierMeta = matchTierMeta(d);
  const importLabels = {
    button: d.banque.importStatement,
    title: d.banque.importTitle,
    intro: d.banque.importIntro,
    account: d.banque.importAccount,
    newAccount: d.banque.importNewAccount,
    accountLabel: d.banque.importAccountLabel,
    iban: d.banque.importIban,
    holder: d.banque.importHolder,
    file: d.banque.importFile,
    submit: d.banque.importSubmit,
    done: d.banque.importDone,
    empty: d.banque.importEmpty,
    failed: d.banque.importFailed,
    tooLarge: d.banque.importTooLarge,
    invalid: d.banque.importInvalid,
    close: d.common.close,
  };
  // The statement import: the way in for every cabinet without an API feed.
  const importCta = real ? <BankImport accounts={BANK_ACCOUNTS.map((b) => ({ id: b.id, label: b.label }))} labels={importLabels} /> : null;
  const sampleNote = real ? null : fmt(d.shell.sampleBanner, { cabinet: ORG.shortName });

  // What a reviewed operation can be assigned to: the live leases, named by
  // their lot and tenants; the engine's closest ones first, per operation.
  const liveLeases = LEASES.filter((l) => l.status === "active" || l.status === "notice");
  const leaseLabel = (leaseId: string): string => {
    const l = liveLeases.find((x) => x.id === leaseId);
    return l ? `${leaseUnitLabel(l)} · ${leaseTenantNames(l).join(", ")}` : leaseId;
  };
  const leaseOptions: LeaseOption[] = liveLeases.map((l) => ({ id: l.id, label: leaseLabel(l.id) }));
  const openInvoices = openInvoicesForMatching();
  const knownIbans = new Map<string, Set<string>>();
  for (const b of IBAN_BINDINGS) knownIbans.set(b.leaseId, (knownIbans.get(b.leaseId) ?? new Set()).add(b.payerIban));
  const candidatesFor = (t: DemoBankTx): ReviewRow["candidates"] => {
    const best = new Map<string, number>();
    for (const inv of openInvoices) {
      const { score } = scoreFuzzy(t, inv, knownIbans.get(inv.leaseId) ?? new Set());
      if (score > (best.get(inv.leaseId) ?? 0)) best.set(inv.leaseId, score);
    }
    return [...best.entries()]
      .filter(([leaseId, score]) => score >= 0.25 && liveLeases.some((l) => l.id === leaseId))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([leaseId, score]) => ({ leaseId, score, label: fmt(d.banque.reviewCandidate, { lease: leaseLabel(leaseId), score: formatPct(Math.round(score * 100), locale) }) }));
  };

  // A real account and a sample cabinet read the same seam: the rows
  // gestion.* holds under the caller's own JWT, or the dataset. The bank
  // screen computes from BANK_ACCOUNTS and BANK_TXS exactly as the property
  // sheet computes from LEASES, so no screen carries a reading of its own.
  // An imported transaction the matcher could not place carries no verdict
  // yet; the review queue is the honest place for it.
  const statusOf = (t: DemoBankTx): BankTxStatus => (t.status === "unmatched" ? "review" : t.status);
  const accounts = BANK_ACCOUNTS;

  const autoCount = BANK_TXS.filter((t) => statusOf(t) === "auto").length;
  const inCount = BANK_TXS.filter((t) => t.amount > 0).length;
  const autoRate = inCount === 0 ? null : Math.round((100 * autoCount) / inCount);

  const rows: TxRow[] = BANK_TXS.map((t) => {
    const status = statusOf(t);
    return {
      id: t.id,
      status,
      counterparty: t.counterpartyName ?? d.common.none,
      remittance: t.remittanceInfo ?? d.common.none,
      explain: t.matchExplain ?? "",
      amountLabel: euros(t.amount, locale),
      negative: t.amount < 0,
      bookedAt: t.bookedAt,
      dateLabel: formatDate(t.bookedAt, locale),
      tier: t.matchTier ? tierMeta[t.matchTier] : null,
      statusMeta: txMeta[status],
    };
  });

  const txById = new Map(BANK_TXS.map((t) => [t.id, t]));
  const review: ReviewRow[] = rows
    .filter((r) => r.status === "review")
    .map((r) => {
      const t = txById.get(r.id)!;
      return {
        id: r.id,
        counterparty: r.counterparty,
        amountLabel: r.amountLabel,
        remittance: r.remittance,
        dateLabel: r.dateLabel,
        explain: r.explain,
        payerIban: t.counterpartyIban,
        candidates: t.amount > 0 ? candidatesFor(t) : [],
      };
    });

  // The overview figures, all derived: the balances the bank reports, the
  // share of credits the engine placed on its own, the money still waiting
  // for a decision.
  const totalBalanceCents = accounts.reduce((sum, b) => sum + b.balanceCents, 0);
  const lastBookedAt = BANK_TXS.reduce<string | null>((latest, t) => (latest === null || t.bookedAt > latest ? t.bookedAt : latest), null);
  const reviewCents = BANK_TXS.filter((t) => statusOf(t) === "review" && t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
  const balanceSub = [
    accounts.length === 1 ? d.banque.balanceOne : fmt(d.banque.balanceMany, { n: accounts.length }),
    lastBookedAt ? fmt(d.banque.lastOperation, { date: formatDate(lastBookedAt, locale) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const initialView = isBankView(params.vue) ? params.vue : "all";

  const workspaceLabels: WorkspaceLabels = {
    views: { all: d.banque.viewAll, review: d.banque.viewReview, auto: d.banque.viewAuto, ignored: d.banque.viewIgnored },
    search: d.banque.searchPlaceholder,
    period: d.banque.periodLabel,
    periods: { all: d.banque.periodAll, "1m": d.banque.period1m, "3m": d.banque.period3m, "6m": d.banque.period6m },
    reset: d.common.resetFilters,
    reviewTitle: d.banque.reviewTitle,
    reviewCount: d.dash.todoCount,
    reviewLegal: d.banque.reviewLegal,
    opsTitle: d.banque.opsTitle,
    emptyTitle: d.banque.emptyTitle,
    emptyBody: d.banque.emptyNoAccount,
    filteredTitle: d.banque.filteredTitle,
    filteredBody: d.banque.filteredBody,
    colOperation: d.banque.colCounterparty,
    colDate: d.banque.colDate,
    colStatus: d.banque.colStatus,
    colAmount: d.banque.colAmount,
    countShown: d.banque.countShown,
    review: {
      assign: d.banque.reviewAssign,
      pick: d.banque.reviewPick,
      suggested: d.banque.reviewSuggested,
      others: d.banque.reviewOthers,
      bind: d.banque.reviewBind,
      match: d.banque.reviewMatch,
      ignore: d.banque.reviewIgnore,
      matched: d.banque.reviewMatched,
      matchedWith: d.banque.reviewMatchedWith,
      boundNote: d.banque.reviewBoundNote,
      ignored: d.banque.reviewIgnored,
      reopen: d.banque.reviewReopen,
      failed: d.banque.reviewFailed,
      already: d.banque.reviewAlready,
      noLeases: d.banque.reviewNoLeases,
    },
  };

  const cascade: Array<[string, string]> = [
    [d.banque.cascade0, d.banque.cascade0Body],
    [d.banque.cascade1, d.banque.cascade1Body],
    [d.banque.cascade2, d.banque.cascade2Body],
    [d.banque.cascade3, d.banque.cascade3Body],
  ];

  const nothingYet = accounts.length === 0 && rows.length === 0;

  return (
    <div>
      <PageHeader
        title={d.banque.title}
        subtitle={d.banque.subtitle}
        actions={
          nothingYet ? undefined : (
            <>
              {accounts.length > 0 &&
                (real ? (
                  <SyncBank label={d.banque.retrieve} labels={syncLabels(d)} />
                ) : (
                  <DemoAction label={d.banque.retrieve} doneMessage={d.banque.retrieveDone} variant="secondary" />
                ))}
              {importCta}
              {connectCta}
            </>
          )
        }
      />

      {real && params.connexion === "retour" && (
        <div className="crm-bank-notice">
          <p role="status">{d.banque.connectReturned}</p>
          <SyncBank auto label={d.banque.retrieve} labels={syncLabels(d)} />
        </div>
      )}

      {!real && params.connexion === "demo" && (
        <div className="crm-bank-notice is-stacked" data-demo-return>
          <p role="status">{d.banque.connectDemoReturned}</p>
          {demoRead && demoRead.accounts.length > 0 && (
            <>
              <p className="crm-bank-notice-sub">
                {fmt(d.banque.connectDemoRead, { provider: demoRead.provider, accounts: demoRead.accounts.length, operations: demoOps })}
              </p>
              <ul className="crm-bank-notice-list">
                {demoRead.accounts.map((a) => (
                  <li key={a.id}>
                    <span className="font-semibold">{a.name}</span>
                    {a.iban && <span className="tabular-nums text-ink-soft">{a.iban}</span>}
                    <span className="font-semibold tabular-nums">{money(a.balance, a.currency)}</span>
                    <span className="text-ink-soft">{fmt(d.banque.connectDemoAccountOps, { n: a.transactions })}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {nothingYet ? (
        <EmptyState
          icon="bank"
          title={d.banque.noAccountTitle}
          body={d.banque.connectBody}
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              {connectCta}
              {importCta}
            </div>
          }
        />
      ) : (
        <>
          <section className="crm-bank-overview" aria-label={d.banque.accountsTitle}>
            {/* The balance leads: the total the bank reports, then each account under it. */}
            <Card className="crm-metric crm-bank-hero">
              <div className="crm-metric-top">
                <span>{d.banque.balanceTitle}</span>
                <span className="crm-symbol">
                  <Icon name="bank" size={22} />
                </span>
              </div>
              <p className="crm-metric-value">{euros(totalBalanceCents, locale)}</p>
              <p className="crm-metric-sub">{balanceSub}</p>
              {accounts.length > 0 && (
                <ul className="crm-bank-accounts">
                  {accounts.map((b) => {
                    const days = b.consentExpiresAt ? diffDays(TODAY, b.consentExpiresAt) : null;
                    return (
                      <li key={b.id}>
                        <div className="min-w-0">
                          <p className="crm-bank-account-name">{b.label}</p>
                          <p className="crm-bank-account-iban">{b.iban}</p>
                          {b.consentExpiresAt && days !== null ? (
                            <p className={"crm-bank-account-note" + (days <= 21 ? " is-warning" : "")}>
                              {fmt(d.banque.consentExpires, { date: formatDate(b.consentExpiresAt, locale), days })}
                            </p>
                          ) : (
                            <p className="crm-bank-account-note">{d.banque.accountImported}</p>
                          )}
                        </div>
                        <span className="crm-bank-account-balance">{euros(b.balanceCents, locale)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            {autoRate !== null && (
              <Card className="crm-metric">
                <div className="crm-metric-top">
                  <span>{d.banque.kpiAuto}</span>
                  <span className="crm-symbol">
                    <Icon name="check" size={22} />
                  </span>
                </div>
                <p className="crm-metric-value">{formatPct(autoRate, locale)}</p>
                <p className="crm-metric-sub">{fmt(d.banque.kpiAutoBody, { auto: autoCount, total: inCount })}</p>
                <div className="crm-metric-progress">
                  <div className="crm-metric-track" aria-hidden>
                    <span style={{ width: `${autoRate}%` }} />
                  </div>
                </div>
                <Link href="/app/banque?vue=auto" className="crm-metric-action">
                  {d.banque.kpiAutoAction}
                  <Icon name="chevron-right" size={15} />
                </Link>
              </Card>
            )}

            <Card className={"crm-metric" + (review.length > 0 ? " crm-metric-attention" : "")}>
              <div className="crm-metric-top">
                <span>{d.banque.kpiReview}</span>
                <span className="crm-symbol">
                  <Icon name={review.length > 0 ? "alert" : "check"} size={22} />
                </span>
              </div>
              <p className="crm-metric-value">{review.length}</p>
              <p className="crm-metric-sub">{review.length > 0 ? fmt(d.banque.kpiReviewBody, { amount: euros(reviewCents, locale) }) : d.banque.kpiReviewNone}</p>
              {review.length > 0 && (
                <a href="#a-verifier" className="crm-metric-action">
                  {d.banque.kpiReviewAction}
                  <Icon name="chevron-right" size={15} />
                </a>
              )}
            </Card>
          </section>

          {/* Keyed on the view so a link to `?vue=auto` lands on that filter even when the page stays mounted. */}
          <BankWorkspace key={initialView} labels={workspaceLabels} rows={rows} review={review} leases={leaseOptions} todayISO={TODAY} sample={!real} sampleNote={sampleNote} initialView={initialView} />

          {/* How the engine decides: reference material, folded by default so the
              screen ends where the work ends. */}
          {rows.length > 0 && (
            <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
              <CollapsiblePanel title={d.banque.cascadeTitle}>
                <ol className="space-y-4 text-sm">
                  {cascade.map(([title, body], i) => (
                    <li key={title} className="flex gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">{i}</span>
                      <div>
                        <p className="font-semibold text-ink">{title}</p>
                        <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">{body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </CollapsiblePanel>

              <CollapsiblePanel title={d.banque.vopTitle}>
                <ul className="divide-y divide-sand-100">
                  {BANK_ACCOUNTS.map((b) => {
                    const check = vopNameCheck(b.holderNameVerbatim, b.holderNameVerbatim);
                    return (
                      <li key={b.id} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold tabular-nums text-ink">{b.iban}</p>
                          <p className="truncate text-sm text-ink-soft">{fmt(d.banque.vopChecked, { name: b.holderNameVerbatim })}</p>
                        </div>
                        <Badge className={check.ok ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}>{check.ok ? d.banque.vopOk : d.banque.vopMismatch}</Badge>
                      </li>
                    );
                  })}
                  <li className="flex items-center justify-between gap-3 py-3">
                    <p className="min-w-0 text-sm leading-relaxed text-ink-soft">{d.banque.vopExample}</p>
                    <Badge className="bg-red-100 text-red-700">{d.banque.vopMismatch}</Badge>
                  </li>
                </ul>
                <LegalNote>{d.banque.vopLegal}</LegalNote>
              </CollapsiblePanel>
            </div>
          )}
        </>
      )}
    </div>
  );
}

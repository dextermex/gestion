import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { CollapsiblePanel, LegalNote } from "@/components/gestion/bits";
import { DemoAction } from "@/components/gestion/DemoAction";
import BankImport from "@/components/gestion/BankImport";
import BankWorkspace, { type LeaseOption, type ReviewRow, type TxRow } from "@/components/gestion/BankWorkspace";
import SaltEdgeConnect from "@/components/gestion/SaltEdgeConnect";
import SyncBank from "@/components/gestion/SyncBank";
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
 * Banking: an accounts rail on the left, the transactions workspace on the
 * right. A real account with no bank connection gets the honest empty rail,
 * never a sample balance.
 */
export default async function BanquePage({
  searchParams,
}: {
  searchParams: Promise<{ connexion?: string }>;
}) {
  const params = await searchParams;
  const { locale, d } = await getI18n();
  const [{ BANK_ACCOUNTS, BANK_TXS, IBAN_BINDINGS, LEASES, ORG, TODAY, leaseTenantNames, leaseUnitLabel, openInvoicesForMatching }, datasetId] = await Promise.all([getDemo(), getDatasetId()]);

  // Real accounts get the real consent journey; sample cabinets keep the
  // demo action, and nothing sample-side ever calls the provider.
  const real = datasetId === "real";
  const connectCta = real ? (
    <SaltEdgeConnect
      label={d.banque.connectAccount}
      notConfigured={d.banque.connectNotConfigured}
      failed={d.banque.connectFailed}
    />
  ) : (
    <DemoAction label={`+ ${d.banque.connectAccount}`} doneMessage={d.banque.connectDone} />
  );
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
      .map(([leaseId, score]) => ({ leaseId, label: fmt(d.banque.reviewCandidate, { lease: leaseLabel(leaseId), score: formatPct(Math.round(score * 100), locale) }) }));
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
      counterparty: t.counterpartyName ?? "—",
      remittance: t.remittanceInfo ?? "—",
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

  const cascade: Array<[string, string]> = [
    [d.banque.cascade0, d.banque.cascade0Body],
    [d.banque.cascade1, d.banque.cascade1Body],
    [d.banque.cascade2, d.banque.cascade2Body],
    [d.banque.cascade3, d.banque.cascade3Body],
  ];

  return (
    <div>
      <PageHeader
        title={d.banque.title}
        subtitle={d.banque.subtitle}
        actions={
          <>
            {accounts.length > 0 &&
              (real ? (
                <SyncBank
                  label={d.banque.retrieve}
                  labels={{
                    notConfigured: d.banque.connectNotConfigured,
                    failed: d.banque.syncFailed,
                    schemaUnexposed: d.banque.schemaUnexposed,
                  }}
                />
              ) : (
                <DemoAction label={d.banque.retrieve} doneMessage={d.banque.retrieveDone} variant="secondary" />
              ))}
            {importCta}
            {connectCta}
          </>
        }
      />

      {real && params.connexion === "retour" && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p role="status" className="text-sm font-semibold text-emerald-800">
            {d.banque.connectReturned}
          </p>
          <SyncBank
            auto
            label={d.banque.retrieve}
            labels={{
              notConfigured: d.banque.connectNotConfigured,
              failed: d.banque.syncFailed,
              schemaUnexposed: d.banque.schemaUnexposed,
            }}
          />
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[290px_minmax(0,1fr)]">
        {/* ------------------------------ accounts rail ------------------------------ */}
        <div className="space-y-4 lg:sticky lg:top-20">
          <Card className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              {d.banque.accountsTitle}
            </p>

            {accounts.length === 0 ? (
              <div className="py-6 text-center">
                <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-sand-100 text-ink-soft">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10 12 4l9 6M5 10v8m4.5-8v8m5-8v8M19 10v8M3 20h18" />
                  </svg>
                </span>
                <p className="mt-3 text-sm font-semibold text-ink">{d.banque.noAccountTitle}</p>
                <p className="mx-auto mt-1.5 max-w-[220px] text-xs leading-relaxed text-ink-soft">
                  {d.banque.connectBody}
                </p>
                <div className="mt-4 flex flex-col items-center gap-2">
                  {connectCta}
                  {importCta}
                </div>
              </div>
            ) : (
              <>
                <ul className="mt-3 space-y-3">
                  {accounts.map((b) => (
                    <li key={b.id} className="rounded-xl border border-sand-200 p-3">
                      <p className="truncate text-xs font-semibold text-ink" title={b.label}>
                        {b.label}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] tabular-nums text-ink-soft">{b.iban}</p>
                      <p className="mt-1.5 font-display text-lg font-bold tracking-tight tabular-nums text-ink">
                        {euros(b.balanceCents, locale)}
                      </p>
                      {b.consentExpiresAt ? (
                        <p
                          className={
                            "mt-0.5 text-[11px] leading-snug " +
                            (diffDays(TODAY, b.consentExpiresAt) <= 21
                              ? "font-semibold text-amber-700"
                              : "text-ink-soft")
                          }
                        >
                          {fmt(d.banque.consentExpires, {
                            date: formatDate(b.consentExpiresAt, locale),
                            days: diffDays(TODAY, b.consentExpiresAt),
                          })}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-[11px] text-ink-soft">{d.banque.accountCamt}</p>
                      )}
                    </li>
                  ))}
                </ul>

                {autoRate !== null && (
                  <div className="mt-3 flex items-baseline justify-between rounded-xl bg-sand-50 px-3 py-2.5">
                    <span className="text-[11px] font-semibold text-ink-soft">{d.banque.kpiAuto}</span>
                    <span
                      className={
                        "font-display text-base font-bold tabular-nums " +
                        (autoRate >= 90 ? "text-emerald-700" : "text-amber-700")
                      }
                    >
                      {formatPct(autoRate, locale)}
                    </span>
                  </div>
                )}

              </>
            )}
          </Card>
        </div>

        {/* ---------------------------- transactions workspace ---------------------------- */}
        <BankWorkspace d={d} rows={rows} review={review} leases={leaseOptions} todayISO={TODAY} sample={!real} sampleNote={sampleNote} />
      </div>

      {/* How the engine decides — reference material, folded by default so the
          screen ends where the work ends. */}
      {rows.length > 0 && (
        <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
          <CollapsiblePanel title={d.banque.cascadeTitle}>
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
          </CollapsiblePanel>

          <CollapsiblePanel title={d.banque.vopTitle}>
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
          </CollapsiblePanel>
        </div>
      )}
    </div>
  );
}

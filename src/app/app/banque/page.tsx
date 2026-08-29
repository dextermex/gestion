import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { CollapsiblePanel, LegalNote } from "@/components/gestion/bits";
import { DemoAction } from "@/components/gestion/DemoAction";
import BankWorkspace, { type ReviewRow, type TxRow } from "@/components/gestion/BankWorkspace";
import SaltEdgeConnect from "@/components/gestion/SaltEdgeConnect";
import SyncBank from "@/components/gestion/SyncBank";
import { getDatasetId, getDemo } from "@/lib/demo";
import { bankTxStatusMeta, euros, formatDate, formatPct, matchTierMeta } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { authedClient, getSession } from "@/lib/supabase/server";
import { getIdentity } from "@/lib/workspace";
import type { BankTxStatus } from "@/lib/types";
import { diffDays } from "@/domain/dates";
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
  const [{ BANK_ACCOUNTS, BANK_TXS, TODAY }, datasetId] = await Promise.all([getDemo(), getDatasetId()]);

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

  // Real accounts read the imported rows from gestion.* under the caller's
  // own JWT (RLS row by row); sample cabinets keep computing from the
  // dataset. Signed-out and harness renders skip the network entirely.
  type DbAccount = {
    id: string; label: string; iban: string;
    balance_cents: number | null; consent_expires_at: string | null;
  };
  type DbTx = {
    id: string; booked_on: string; amount_cents: number; counterparty_name: string;
    remittance_info: string; match_status: string; match_explain: string | null;
  };
  let dbAccounts: DbAccount[] = [];
  let dbTxs: DbTx[] = [];
  if (real) {
    const session = await getSession();
    const identity = session ? await getIdentity() : null;
    if (session && identity?.active) {
      const g = authedClient(session.accessToken).schema("gestion");
      const [accRes, txRes] = await Promise.all([
        g.from("bank_accounts")
          .select("id,label,iban,balance_cents,consent_expires_at")
          .eq("org_id", identity.active.id)
          .order("created_at"),
        g.from("bank_transactions")
          .select("id,booked_on,amount_cents,counterparty_name,remittance_info,match_status,match_explain")
          .eq("org_id", identity.active.id)
          .order("booked_on", { ascending: false })
          .limit(500),
      ]);
      dbAccounts = (accRes.data as DbAccount[] | null) ?? [];
      dbTxs = (txRes.data as DbTx[] | null) ?? [];
    }
  }

  // Imported rows carry no match verdict yet: they land in the review queue,
  // which is the honest place for them until the matching engine runs here.
  const DB_STATUS: Record<string, BankTxStatus> = {
    unmatched: "review", auto: "auto", manual: "manual", review: "review", ignored: "ignored",
  };

  const accounts = real
    ? dbAccounts.map((a) => ({
        id: a.id,
        label: a.label,
        iban: a.iban,
        balanceCents: a.balance_cents ?? 0,
        consentExpiresAt: a.consent_expires_at ? a.consent_expires_at.slice(0, 10) : null,
      }))
    : BANK_ACCOUNTS;

  const autoCount = real
    ? dbTxs.filter((t) => DB_STATUS[t.match_status] === "auto").length
    : BANK_TXS.filter((t) => t.status === "auto").length;
  const inCount = real
    ? dbTxs.filter((t) => t.amount_cents > 0).length
    : BANK_TXS.filter((t) => t.amount > 0).length;
  const autoRate = inCount === 0 ? null : Math.round((100 * autoCount) / inCount);

  const rows: TxRow[] = real ? dbTxs.map((t) => {
    const status = DB_STATUS[t.match_status] ?? "review";
    return {
      id: t.id,
      status,
      counterparty: t.counterparty_name || "—",
      remittance: t.remittance_info || "—",
      explain: t.match_explain ?? "",
      amountLabel: euros(t.amount_cents, locale),
      negative: t.amount_cents < 0,
      bookedAt: t.booked_on,
      dateLabel: formatDate(t.booked_on, locale),
      tier: null,
      statusMeta: txMeta[status],
    };
  }) : BANK_TXS.map((t) => ({
    id: t.id,
    status: t.status,
    counterparty: t.counterpartyName ?? "—",
    remittance: t.remittanceInfo ?? "—",
    explain: t.matchExplain ?? "",
    amountLabel: euros(t.amount, locale),
    negative: t.amount < 0,
    bookedAt: t.bookedAt,
    dateLabel: formatDate(t.bookedAt, locale),
    tier: t.matchTier ? tierMeta[t.matchTier] : null,
    statusMeta: txMeta[t.status],
  }));

  const review: ReviewRow[] = real
    ? rows
        .filter((r) => r.status === "review")
        .map((r) => ({
          id: r.id,
          counterparty: r.counterparty,
          amountLabel: r.amountLabel,
          remittance: r.remittance,
          dateLabel: r.dateLabel,
          explain: r.explain,
        }))
    : BANK_TXS.filter((t) => t.status === "review").map((t) => ({
        id: t.id,
        counterparty: t.counterpartyName ?? "—",
        amountLabel: euros(t.amount, locale),
        remittance: t.remittanceInfo ?? "—",
        dateLabel: formatDate(t.bookedAt, locale),
        explain: t.matchExplain ?? "",
      }));

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
                <div className="mt-4 flex justify-center">{connectCta}</div>
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
        <BankWorkspace d={d} rows={rows} review={review} todayISO={TODAY} />
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

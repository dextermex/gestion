import Link from "next/link";
import { Badge, Card, PageHeader, EmptyState } from "@/components/pro/ui";
import { LegalNote, MetaBadge, Panel } from "@/components/gestion/bits";
import { DepositLineActions, DepositReceive, DepositSettlementActions } from "@/components/gestion/DepositActions";
import { getDemo, isSampleData } from "@/lib/demo";
import { depositFormLabels, depositStatusMeta, euros, formatDate, type DepositStatus } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { settlementNotes } from "@/lib/i18n/engine";
import { computeSettlement } from "@/domain/deposits/settlement";

/** A restitution is in progress from the moment the keys are back until the last cent has left. */
const inProgress = (status: DepositStatus) => status === "release_pending" || status === "partially_released" || status === "disputed";

export default async function GarantiesPage() {
  const { locale, d } = await getI18n();
  const { DEPOSITS, ENDED_LEASES, LEASES, ORG, TODAY, leaseTenantNames, leaseUnitLabel } = await getDemo();
  const sample = await isSampleData();
  const writable = !sample;
  const sampleNote = sample ? fmt(d.shell.sampleBanner, { cabinet: ORG.shortName }) : null;

  // A real account with nothing in it: say so rather than reach for a
  // showcase record that no longer exists.
  if (DEPOSITS.length === 0)
    return (
      <div>
        <EmptyState title={fmt(d.common.emptyTitle, { section: d.hubs.deposits })} body={d.common.emptyBody} />
      </div>
    );
  const formLabels = depositFormLabels(d);
  const statusMeta = depositStatusMeta(d);

  // Lease facts for a deposit, whether its lease is still live or ended.
  const leaseFacts = (leaseId: string): { label: string; tenant: string; rentCents: number; live: boolean } => {
    const live = LEASES.find((l) => l.id === leaseId);
    if (live) {
      return { label: leaseUnitLabel(live), tenant: leaseTenantNames(live).join(", "), rentCents: live.rentCents, live: true };
    }
    const ended = ENDED_LEASES.find((e) => e.id === leaseId);
    return { label: ended?.label ?? "", tenant: ended?.tenant ?? "", rentCents: ended?.rentCents ?? 0, live: false };
  };

  // Every restitution in progress, computed by the engine from the rows as they stand.
  const settlements = DEPOSITS.filter((x) => inProgress(x.status)).map((dep) => {
    const facts = leaseFacts(dep.leaseId);
    const input = {
      depositAmount: dep.amountCents,
      depositForm: dep.form,
      monthlyRent: facts.rentCents,
      keyHandoverDate: dep.keyHandoverOn ?? TODAY,
      decompteIssuedAt: dep.decompteIssuedOn ?? null,
      entryEdlExists: dep.entryEdlExists,
      deductions: dep.deductions.map((x) => ({
        id: x.id,
        kind: x.kind,
        label: x.label,
        amount: x.amountCents,
        justificationDocRef: x.justificationDocRef,
        justifiedAt: x.justifiedAt,
        edlItemRef: x.edlItemRef,
      })),
      miseEnDemeureArDate: dep.miseEnDemeureArOn ?? null,
      releasedFirstTranche: dep.releasedFirstTrancheCents,
      releasedBalance: dep.releasedBalanceCents,
      asOf: TODAY,
    };
    const settlement = computeSettlement(input);
    const warnings = settlementNotes(d, locale, input, settlement);
    // What each tranche would release now: the engine's amount, once each,
    // the balance only after the décompte. Zero hides the button.
    const firstTrancheCents = dep.releasedFirstTrancheCents > 0 ? 0 : Math.min(settlement.firstTrancheAmount, settlement.outstandingToTenant);
    const balanceCents = !dep.decompteIssuedOn || dep.releasedBalanceCents > 0 ? 0 : settlement.outstandingToTenant;
    return { dep, facts, settlement, warnings, firstTrancheCents, balanceCents };
  });

  const held = DEPOSITS.filter((x) => !inProgress(x.status));

  const LINE_STATUS: Record<string, { label: string; color: string }> = {
    justified: { label: d.garanties.lineJustified, color: "bg-emerald-100 text-emerald-800" },
    pending: { label: d.garanties.linePending, color: "bg-amber-100 text-amber-800" },
    expired_forfeited: { label: d.garanties.lineForfeited, color: "bg-red-100 text-red-700" },
    blocked_no_entry_edl: { label: d.garanties.lineBlocked, color: "bg-red-100 text-red-700" },
  };
  const KIND_LABEL: Record<string, string> = {
    damage: d.garanties.lineDamage,
    arrears: d.garanties.lineArrears,
    charge_reserve: d.garanties.lineReserve,
  };

  return (
    <div>
      <PageHeader title={d.garanties.title} subtitle={d.garanties.subtitle} />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-5">
        {settlements.length > 0 && (
        <div className="space-y-5 lg:col-span-3">
          {settlements.map(({ dep: showcase, facts: showcaseFacts, settlement, warnings, firstTrancheCents, balanceCents }) => (
          <Panel key={showcase.id} title={fmt(d.garanties.settlementTitle, { label: showcaseFacts.label })}>
            <div className="flex flex-wrap items-center gap-2">
              <MetaBadge meta={statusMeta[showcase.status]} />
              <Badge className="bg-sand-100 text-ink-soft">{formLabels[showcase.form]}</Badge>
              <span className="text-xs text-ink-soft">
                {showcaseFacts.tenant} ·{" "}
                {fmt(d.garanties.keysReturned, { date: formatDate(showcase.keyHandoverOn ?? null, locale) })}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-sand-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                  {d.garanties.deposit}
                </p>
                <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink">
                  {euros(showcase.amountCents, locale)}
                </p>
              </div>
              <div className="rounded-xl bg-sand-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                  {d.garanties.validRetentions}
                </p>
                <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink">
                  {euros(settlement.totalRetained, locale)}
                </p>
              </div>
              <div className="rounded-xl bg-sand-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                  {d.garanties.dueToTenant}
                </p>
                <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-emerald-700">
                  {euros(settlement.outstandingToTenant, locale)}
                </p>
              </div>
            </div>

            <ul className="mt-4 space-y-2">
              {settlement.lines.map((line) => (
                <li
                  key={line.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-sand-200 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{line.label}</p>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {KIND_LABEL[line.kind]} ·{" "}
                      {line.justificationDeadline
                        ? fmt(d.garanties.lineJustifyBefore, {
                            date: formatDate(line.justificationDeadline, locale),
                          })
                        : d.garanties.lineJustifyAfterDecompte}
                      {line.justificationDocRef
                        ? ` · ${fmt(d.garanties.lineDoc, { ref: line.justificationDocRef })}`
                        : ""}
                    </p>
                    {showcase.keyHandoverOn && (
                      <DepositLineActions
                        depositId={showcase.id}
                        lineId={line.id}
                        lineStatus={line.status}
                        todayISO={TODAY}
                        writable={writable}
                        labels={d.garanties}
                      />
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="tabular-nums text-sm font-semibold text-ink">{euros(line.retained, locale)}</span>
                    <Badge className={LINE_STATUS[line.status].color}>{LINE_STATUS[line.status].label}</Badge>
                  </div>
                </li>
              ))}
            </ul>

            {warnings.length > 0 && (
              <div className="mt-4 space-y-1.5">
                {warnings.map((w) => (
                  <p key={w} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {w}
                  </p>
                ))}
              </div>
            )}

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                  {d.garanties.tranche1}
                </p>
                <p className="mt-0.5 text-sm font-semibold text-emerald-800">
                  {fmt(d.garanties.tranche1Paid, {
                    amount: euros(showcase.releasedFirstTrancheCents, locale),
                    due: formatDate(settlement.firstTrancheDueAt, locale),
                  })}
                </p>
              </div>
              <div className="rounded-xl border border-sand-200 bg-sand-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                  {d.garanties.trancheBalance}
                </p>
                <p className="mt-0.5 text-sm font-semibold text-ink">
                  {euros(settlement.balanceAmount, locale)} ·{" "}
                  {settlement.balanceDueAt
                    ? fmt(d.garanties.trancheBalanceDue, { date: formatDate(settlement.balanceDueAt, locale) })
                    : d.garanties.trancheBalanceWaiting}
                </p>
              </div>
            </div>

            {showcase.keyHandoverOn && (
              <DepositSettlementActions
                depositId={showcase.id}
                status={showcase.status}
                keyHandoverOn={showcase.keyHandoverOn}
                decompteIssuedOn={showcase.decompteIssuedOn ?? null}
                miseEnDemeureArOn={showcase.miseEnDemeureArOn ?? null}
                firstTrancheCents={firstTrancheCents}
                balanceCents={balanceCents}
                releasedFirstTrancheCents={showcase.releasedFirstTrancheCents}
                todayISO={TODAY}
                locale={locale}
                writable={writable}
                sampleNote={sampleNote}
                labels={d.garanties}
              />
            )}

            <p className="mt-3 text-xs text-ink-soft">
              {fmt(d.garanties.releaseLabel, {
                form: formLabels[showcase.form],
                how: d.legal.settlement.release[showcase.form],
              })}
            </p>

            <LegalNote>{d.garanties.legal}</LegalNote>
          </Panel>
          ))}
        </div>
        )}

        <div className={settlements.length > 0 ? "lg:col-span-2" : "lg:col-span-5"}>
          <Panel title={d.garanties.heldTitle}>
            <ul className="divide-y divide-sand-100">
              {held.map((dep) => {
                const facts = leaseFacts(dep.leaseId);
                return (
                  <li key={dep.id} className="py-3" data-deposit={dep.id}>
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        {facts.live ? (
                          <Link
                            href={`/app/baux/${dep.leaseId}`}
                            className="block truncate text-sm font-semibold text-ink hover:text-brand-700 max-sm:leading-10"
                          >
                            {facts.label}
                          </Link>
                        ) : (
                          <p className="block truncate text-sm font-semibold text-ink">{facts.label}</p>
                        )}
                        <p className="truncate text-xs text-ink-soft">
                          {facts.tenant} · {formLabels[dep.form]}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
                        <span className="tabular-nums text-sm font-semibold text-ink">{euros(dep.amountCents, locale)}</span>
                        <MetaBadge meta={statusMeta[dep.status]} />
                      </div>
                    </div>
                    {dep.status === "pending" && (
                      <DepositReceive depositId={dep.id} todayISO={TODAY} locale={locale} writable={writable} sampleNote={sampleNote} labels={d.garanties} />
                    )}
                  </li>
                );
              })}
            </ul>
            <Card className="mt-4 border-dashed bg-sand-50/50 p-4">
              <p className="text-xs leading-relaxed text-ink-soft">{d.garanties.heldFoot}</p>
            </Card>
          </Panel>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button, Field, Input, Select } from "@/components/pro/ui";
import { StepCard, WizardFooter } from "@/components/gestion/WizardChrome";
import { Icon } from "@/components/pro/icons";
import type { Dict } from "@/lib/i18n/fr";

/**
 * A tenant leaves.
 *
 * The one thing this flow must never do is lose anything. The tenancy is
 * closed, not erased: it keeps its payments, its inventory and its documents
 * and becomes the property's history, readable under Historique for as long
 * as the property exists. What stops is the future, the months that would
 * have been owed and now never will be.
 *
 * Seven steps in the order a departure actually happens: the date, the exit
 * inventory, the meters, the keys, what is still owed, what happens to the
 * guarantee, and a last look before it is committed. Every step offers the
 * same three moves as the rental dossier (back, save and continue later,
 * next), and each move saves where the departure stands on the lease row,
 * so the exit inventory (a journey of its own) hands back here and a
 * refresh loses nothing. Nothing changes for the tenancy until the last
 * step confirms it: until then the lot is occupied and rent falls due.
 */

export type DepartureMeter = {
  id: string;
  label: string;
  unit: string;
  last: { value: number; date: string } | null;
};

export type DepartureExisting = {
  step: number;
  endDate: string | null;
  keysReturned: boolean;
  keysReturnedOn: string | null;
  depositOutcome: string;
  releasedAmount: string;
  decompteIssuedOn: string | null;
  metersDone: boolean;
};

export type DepartureLease = {
  id: string;
  unitId: string;
  tenantNames: string;
  unitLabel: string;
  propertyId: string;
  propertyName: string;
  startDate: string;
  monthlyLabel: string;
  outstandingLabel: string | null;
  depositLabel: string | null;
  hasExitEdl: boolean;
  meters: DepartureMeter[];
  /** The ledger's periods, as the first day of each month, and whether money went into them. */
  periods: Array<{ month: string; allocated: boolean }>;
  /** Where a departure already being recorded stands, if one is. */
  existing: DepartureExisting | null;
  /** The step to open on: from the URL, else where the departure stands, else the first. */
  startStep: number;
};

const OUTCOMES = ["release_pending", "released", "partially_released", "forfeited", "disputed"] as const;
type Outcome = (typeof OUTCOMES)[number];
const TOTAL = 7;

/** The first day of the month after `date`. */
const monthAfter = (date: string): string => {
  const [y, m] = date.slice(0, 7).split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};

export default function DepartureWizard({
  d,
  lease,
  real,
  notice,
}: {
  d: Dict;
  lease: DepartureLease;
  real: boolean;
  notice: string;
}) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const ex = lease.existing;

  const [step, setStep] = useState(Math.min(Math.max(lease.startStep, 1), TOTAL));
  const [endDate, setEndDate] = useState(ex?.endDate ?? new Date().toISOString().slice(0, 10));
  const [keysReturned, setKeysReturned] = useState(ex?.keysReturned ?? true);
  const [keysReturnedOn, setKeysReturnedOn] = useState(ex?.keysReturnedOn ?? "");
  const [depositOutcome, setDepositOutcome] = useState<Outcome>(
    (OUTCOMES as readonly string[]).includes(ex?.depositOutcome ?? "") ? (ex!.depositOutcome as Outcome) : "release_pending",
  );
  const [releasedAmount, setReleasedAmount] = useState(ex?.releasedAmount ?? "");
  const [decompteIssuedOn, setDecompteIssuedOn] = useState(ex?.decompteIssuedOn ?? "");
  const [metersDone, setMetersDone] = useState(ex?.metersDone ?? false);
  const [readings, setReadings] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ droppedPeriods: number } | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(endDate) && endDate > lease.startDate;
  // Months after the departure that nothing was paid into: they will go.
  const dropped = dateOk ? lease.periods.filter((p) => p.month >= monthAfter(endDate) && !p.allocated).length : 0;

  /** The URL always names the step, so a refresh lands here. */
  const syncUrl = (at: number) => {
    if (typeof window === "undefined") return;
    window.history.replaceState(window.history.state, "", `/app/biens/depart?bail=${lease.id}&etape=${at}`);
  };

  /** Writes where the departure stands. Nothing about the tenancy changes. */
  const save = async (from: number): Promise<boolean> => {
    if (!real) return true;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/baux/${lease.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "departure",
          departure: {
            step: from,
            endDate: dateOk ? endDate : null,
            keysReturned,
            keysReturnedOn: keysReturnedOn || null,
            depositOutcome,
            releasedAmount,
            decompteIssuedOn: decompteIssuedOn || null,
            metersDone,
          },
        }),
      });
      if (res.status === 401) {
        window.location.assign(`/connexion?next=${encodeURIComponent(`/app/biens/depart?bail=${lease.id}`)}`);
        return false;
      }
      if (!res.ok) {
        setError(d.departure.saveFailed);
        return false;
      }
      return true;
    } catch {
      setError(d.departure.saveFailed);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const go = (to: number) => {
    setStep(to);
    syncUrl(to);
  };

  const advance = async () => {
    if (saving) return;
    if (step === 1 && !dateOk) {
      setError(d.departure.endBeforeStart);
      return;
    }
    if (!(await save(step + 1))) return;
    go(step + 1);
  };

  const back = () => {
    if (saving) return;
    go(step - 1);
  };

  const saveAndLeave = async () => {
    if (saving) return;
    setLeaving(true);
    try {
      if (!(await save(step))) return;
    } finally {
      setLeaving(false);
    }
    router.push(`/app/biens/${lease.propertyId}?onglet=location&lot=${lease.unitId}`);
    router.refresh();
  };

  /** The exit inventory is its own journey; the departure is saved first and the inventory hands back to the next step. */
  const startEdl = async () => {
    if (!(await save(2))) return;
    const back = `/app/biens/depart?bail=${lease.id}&etape=3`;
    router.push(`/app/biens/etat-des-lieux?bail=${lease.id}&type=exit&retour=${encodeURIComponent(back)}`);
  };

  /** The readings typed are recorded on their meters, dated the departure, then the flow moves on. */
  const recordMeters = async () => {
    if (saving) return;
    const typed = lease.meters.filter((m) => (readings[m.id] ?? "").trim() !== "");
    if (real && typed.length > 0) {
      setSaving(true);
      setError(null);
      try {
        for (const m of typed) {
          const res = await fetch(`/api/compteurs/${m.id}/releves`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: readings[m.id], readOn: dateOk ? endDate : undefined, source: "edl" }),
          });
          if (!res.ok) {
            setError(d.departure.saveFailed);
            return;
          }
        }
      } catch {
        setError(d.departure.saveFailed);
        return;
      } finally {
        setSaving(false);
      }
    }
    if (typed.length > 0) setMetersDone(true);
    if (!(await save(4))) return;
    go(4);
  };

  /** The one move that ends the tenancy. */
  const confirm = async () => {
    if (!real) {
      setStep(TOTAL + 1);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/baux/${lease.id}/cloture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endDate, keysReturned, keysReturnedOn: keysReturnedOn || null, depositOutcome, releasedAmount, decompteIssuedOn }),
      });
      if (res.status === 401) {
        window.location.assign(`/connexion?next=${encodeURIComponent(`/app/biens/depart?bail=${lease.id}`)}`);
        return;
      }
      if (res.status === 400) {
        setError(d.departure.endBeforeStart);
        return;
      }
      if (!res.ok) {
        setError(d.departure.saveFailed);
        return;
      }
      setResult((await res.json()) as { droppedPeriods: number });
      // The done screen is this component's own state. Refreshing the route
      // here would re-run the page for a lease that has just ended, and that
      // page sends ended leases to the property's history: the confirmation
      // would vanish before it was read. The screens it links to are dynamic
      // and read the closed lease for themselves.
      setStep(TOTAL + 1);
    } catch {
      setError(d.departure.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  const slide = (dir: 1 | -1) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
      : {
          initial: { opacity: 0, x: 32 * dir },
          animate: { opacity: 1, x: 0 },
          exit: { opacity: 0, x: -32 * dir },
          transition: { type: "spring" as const, stiffness: 340, damping: 34 },
        };

  const titles: Record<number, string> = {
    1: d.departure.titleDate,
    2: d.departure.titleEdl,
    3: d.departure.titleMeters,
    4: d.departure.titleKeys,
    5: d.departure.titleOutstanding,
    6: d.departure.titleGuarantee,
    7: d.departure.titleConfirm,
  };

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const Heading = (
    <>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-balance text-center font-display text-2xl font-bold tracking-tight text-ink outline-none sm:text-3xl"
      >
        {titles[step]}
      </h1>
      <p className="mt-2 text-center text-sm text-ink-soft">
        {lease.tenantNames} · {lease.unitLabel} · {lease.propertyName}
      </p>
    </>
  );

  const errorLine = error && (
    <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
      {error}
    </p>
  );

  // The same three moves on every step: back, save and continue later, next.
  const footer = (moves: { onNext: () => void; nextLabel?: string; canNext?: boolean }) => (
    <WizardFooter
      d={d}
      backHref={step === 1 ? `/app/biens/${lease.propertyId}?onglet=location&lot=${lease.unitId}` : null}
      onBack={back}
      busy={saving}
      leaving={leaving}
      onSaveLater={() => void saveAndLeave()}
      onNext={moves.onNext}
      nextLabel={moves.nextLabel}
      canNext={moves.canNext}
    />
  );

  const summary = [
    { k: d.departure.endDate, v: endDate },
    { k: d.departure.titleEdl, v: lease.hasExitEdl ? d.common.yes : d.common.no },
    { k: d.departure.titleMeters, v: metersDone ? d.common.yes : d.common.no },
    { k: d.departure.keysReturnedLabel, v: keysReturned ? (keysReturnedOn || endDate) : d.common.no },
    { k: d.departure.titleOutstanding, v: lease.outstandingLabel ?? d.departure.outstandingNone },
    { k: d.departure.depositOutcome, v: d.status.deposit[depositOutcome] },
  ];

  const overlay = (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-sand-50">
      <div className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-sand-100 bg-white/90 px-4 backdrop-blur sm:px-6">
        {step === 1 || step > TOTAL ? (
          <Link
            href={`/app/biens/${lease.propertyId}?onglet=location&lot=${lease.unitId}`}
            className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink max-sm:min-h-11"
          >
            <BackIcon />
            {d.location.backToProperty}
          </Link>
        ) : (
          <button onClick={back} className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink max-sm:min-h-11">
            <BackIcon />
            {d.common.back}
          </button>
        )}
        {step <= TOTAL && (
          <p className="absolute left-1/2 hidden -translate-x-1/2 text-sm text-ink-soft sm:block">
            {d.biens.wizStepOf.replace("{n}", String(step)).replace("{total}", String(TOTAL))}
          </p>
        )}
      </div>

      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
        <AnimatePresence mode="wait" initial={false}>
          {step === 1 && (
            <motion.div key="s1" {...slide(-1)}>
              {Heading}
              <StepCard>
                {ex && ex.step > 1 && (
                  <p role="status" className="mb-4 rounded-xl bg-sand-50 px-3.5 py-2.5 text-sm text-ink-soft">
                    {d.departure.resumeHint.replace("{n}", String(ex.step))}
                  </p>
                )}
                <Field label={d.departure.endDate} hint={d.departure.endDateHint}>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </Field>
                <p className="mt-3 text-xs leading-relaxed text-ink-soft">{d.departure.dateNote}</p>
                {errorLine}
                {footer({ onNext: () => void advance(), canNext: dateOk })}
              </StepCard>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="s2" {...slide(1)}>
              {Heading}
              <StepCard>
                {lease.hasExitEdl ? (
                  <p className="rounded-xl bg-emerald-50 p-3.5 text-sm font-semibold text-emerald-800">{d.departure.edlDone}</p>
                ) : (
                  <>
                    <p className="text-sm leading-relaxed text-ink-soft">{d.departure.edlHint}</p>
                    {real ? (
                      <Button className="mt-4" loading={saving} onClick={() => void startEdl()}>
                        <Icon name="plus" size={15} />
                        {d.departure.edlStart}
                      </Button>
                    ) : (
                      <p className="mt-4 text-sm text-ink-soft">{notice}</p>
                    )}
                  </>
                )}
                {errorLine}
                {footer({ onNext: () => void advance(), nextLabel: lease.hasExitEdl ? undefined : d.departure.edlSkip })}
              </StepCard>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div key="s3" {...slide(1)}>
              {Heading}
              <StepCard>
                <p className="text-sm leading-relaxed text-ink-soft">{d.departure.metersHint}</p>
                {lease.meters.length === 0 ? (
                  <p className="mt-4 rounded-xl bg-sand-50 px-3.5 py-3 text-sm text-ink-soft">{d.departure.metersNone}</p>
                ) : (
                  <ul className="mt-4 space-y-3">
                    {lease.meters.map((m) => (
                      <li key={m.id}>
                        <Field
                          label={`${m.label} (${m.unit})`}
                          hint={
                            m.last
                              ? d.departure.meterLast.replace("{value}", String(m.last.value)).replace("{unit}", m.unit).replace("{date}", m.last.date)
                              : d.departure.meterNoReading
                          }
                        >
                          <Input
                            inputMode="decimal"
                            placeholder={d.departure.meterValue}
                            value={readings[m.id] ?? ""}
                            onChange={(e) => setReadings((r) => ({ ...r, [m.id]: e.target.value }))}
                            className="text-right tabular-nums"
                          />
                        </Field>
                      </li>
                    ))}
                  </ul>
                )}
                {metersDone && <p className="mt-3 text-sm font-semibold text-emerald-700">{d.departure.titleMeters}</p>}
                {errorLine}
                {footer({ onNext: () => void recordMeters() })}
              </StepCard>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div key="s4" {...slide(1)}>
              {Heading}
              <StepCard>
                <p className="text-sm leading-relaxed text-ink-soft">{d.departure.keysHint}</p>
                <label className="mt-4 flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={keysReturned}
                    onChange={(e) => setKeysReturned(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-sand-300 text-brand-600 focus:ring-brand-400"
                  />
                  <span className="text-sm text-ink">{d.departure.keysReturnedLabel}</span>
                </label>
                {keysReturned && (
                  <div className="mt-3">
                    <Field label={d.departure.keysReturnedOn}>
                      <Input type="date" value={keysReturnedOn} placeholder={endDate} onChange={(e) => setKeysReturnedOn(e.target.value)} />
                    </Field>
                  </div>
                )}
                {errorLine}
                {footer({ onNext: () => void advance() })}
              </StepCard>
            </motion.div>
          )}

          {step === 5 && (
            <motion.div key="s5" {...slide(1)}>
              {Heading}
              <StepCard>
                {lease.outstandingLabel ? (
                  <p className="rounded-xl bg-amber-50 p-3.5 text-sm text-ink">
                    {d.departure.outstandingIs}{" "}
                    <span className="font-display text-base font-bold tabular-nums">{lease.outstandingLabel}</span>
                  </p>
                ) : (
                  <p className="rounded-xl bg-emerald-50 p-3.5 text-sm font-semibold text-emerald-800">{d.departure.outstandingNone}</p>
                )}
                <p className="mt-3 text-sm text-ink-soft">
                  {dropped > 0 ? d.departure.periodsDropped.replace("{n}", String(dropped)) : d.departure.periodsNoneDropped}
                </p>
                <p className="mt-3 text-xs leading-relaxed text-ink-soft">{d.departure.outstandingNote}</p>
                {errorLine}
                {footer({ onNext: () => void advance() })}
              </StepCard>
            </motion.div>
          )}

          {step === 6 && (
            <motion.div key="s6" {...slide(1)}>
              {Heading}
              <StepCard>
                {lease.depositLabel ? (
                  <p className="text-sm text-ink-soft">
                    {d.departure.depositHeld}{" "}
                    <span className="font-display text-base font-bold tabular-nums text-ink">{lease.depositLabel}</span>
                  </p>
                ) : (
                  <p className="text-sm text-ink-soft">{d.bien.noDeposit}</p>
                )}
                <div className="mt-4 space-y-3">
                  <Field label={d.departure.depositOutcome}>
                    <Select value={depositOutcome} onChange={(e) => setDepositOutcome(e.target.value as Outcome)}>
                      {OUTCOMES.map((o) => (
                        <option key={o} value={o}>
                          {d.status.deposit[o]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {(depositOutcome === "released" || depositOutcome === "partially_released") && (
                    <Field label={d.departure.releasedAmount}>
                      <Input inputMode="decimal" className="text-right tabular-nums" value={releasedAmount} onChange={(e) => setReleasedAmount(e.target.value)} />
                    </Field>
                  )}
                  <Field label={d.departure.decompteIssuedOn} hint={d.departure.decompteHint}>
                    <Input type="date" value={decompteIssuedOn} onChange={(e) => setDecompteIssuedOn(e.target.value)} />
                  </Field>
                </div>
                {errorLine}
                {footer({ onNext: () => void advance() })}
              </StepCard>
            </motion.div>
          )}

          {step === 7 && (
            <motion.div key="s7" {...slide(1)}>
              {Heading}
              <StepCard>
                <dl className="divide-y divide-sand-100">
                  {summary.map((r) => (
                    <div key={r.k} className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0">
                      <dt className="text-sm text-ink-soft">{r.k}</dt>
                      <dd className="text-right text-sm font-semibold text-ink">{r.v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-4 rounded-xl bg-sand-50 px-3.5 py-3 text-sm leading-relaxed text-ink-soft">{d.departure.confirmNote}</p>
                {errorLine}
                {footer({ onNext: () => void confirm(), nextLabel: d.departure.confirm })}
              </StepCard>
            </motion.div>
          )}

          {step > TOTAL && (
            <motion.div key="done" {...slide(1)} className="mx-auto max-w-xl text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <Icon name="check" size={28} />
              </span>
              <h1 ref={headingRef} tabIndex={-1} className="mt-5 font-display text-2xl font-bold tracking-tight text-ink outline-none">
                {d.departure.doneTitle.replace("{tenant}", lease.tenantNames)}
              </h1>
              {real ? (
                <>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">{d.departure.doneBody}</p>
                  {result && result.droppedPeriods > 0 && (
                    <p className="mt-2 text-sm text-ink-soft">{d.departure.doneDropped.replace("{n}", String(result.droppedPeriods))}</p>
                  )}
                </>
              ) : (
                <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                  {notice}
                </p>
              )}
              <div className="mt-6 flex flex-col gap-2.5">
                <Button onClick={() => router.push(`/app/biens/locataire?lot=${lease.unitId}`)}>
                  <Icon name="plus" size={15} />
                  {d.bien.addNewTenant}
                </Button>
                <Button variant="secondary" onClick={() => router.push(`/app/biens/${lease.propertyId}`)}>
                  {d.location.backToProperty}
                </Button>
                <Button variant="ghost" onClick={() => router.push(`/app/biens/${lease.propertyId}?onglet=historique`)}>
                  {d.bien.tabHistory}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );

  return mounted ? createPortal(overlay, document.body) : overlay;
}

function BackIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7 7-7M3 12h18" />
    </svg>
  );
}

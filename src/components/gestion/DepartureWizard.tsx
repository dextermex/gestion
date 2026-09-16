"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button, Field, Input, Select } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import type { Dict } from "@/lib/i18n/fr";

/**
 * A tenant leaves.
 *
 * The one thing this flow must never do is lose anything. The tenancy is
 * closed, not erased: it keeps its payments, its inventory and its documents
 * and becomes the property's history, readable under Historique for as long
 * as the property exists. What stops is the future — the months that would
 * have been owed and now never will be.
 *
 * Six steps in the order a departure actually happens: the date, the exit
 * inspection, the keys, what is still owed, what happens to the guarantee,
 * and a last look before it is committed.
 */

export type DepartureLease = {
  id: string;
  tenantNames: string;
  unitLabel: string;
  propertyId: string;
  propertyName: string;
  startDate: string;
  monthlyLabel: string;
  outstandingLabel: string | null;
  depositLabel: string | null;
  hasExitEdl: boolean;
};

const OUTCOMES = ["release_pending", "released", "partially_released", "forfeited", "disputed"] as const;

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

  const [step, setStep] = useState(1);
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [keysReturned, setKeysReturned] = useState(true);
  const [depositOutcome, setDepositOutcome] = useState<(typeof OUTCOMES)[number]>("release_pending");
  const [releasedAmount, setReleasedAmount] = useState("");
  const [decompteIssuedOn, setDecompteIssuedOn] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ droppedPeriods: number } | null>(null);

  const LAST = 6;
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const confirm = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/baux/${lease.id}/cloture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endDate, keysReturned, depositOutcome, releasedAmount, decompteIssuedOn }),
      });
      if (res.status === 401) {
        window.location.assign(`/connexion?next=/app/biens/depart?bail=${lease.id}`);
        return;
      }
      if (res.status === 400) {
        setError(d.departure.endBeforeStart);
        setSaving(false);
        return;
      }
      if (!res.ok) {
        setError(d.departure.saveFailed);
        setSaving(false);
        return;
      }
      setResult((await res.json()) as { droppedPeriods: number });
      setStep(LAST + 1);
    } catch {
      setError(d.departure.saveFailed);
    }
    setSaving(false);
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
    3: d.departure.titleKeys,
    4: d.departure.titleOutstanding,
    5: d.departure.titleGuarantee,
    6: d.departure.titleConfirm,
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

  const Card = ({ children }: { children: React.ReactNode }) => (
    <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm">{children}</div>
  );
  const Next = ({ onClick, label }: { onClick: () => void; label?: string }) => (
    <div className="mt-6 flex justify-end">
      <Button onClick={onClick}>{label ?? d.common.next}</Button>
    </div>
  );

  const overlay = (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-sand-50">
      <div className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-sand-100 bg-white/90 px-4 backdrop-blur sm:px-6">
        {step === 1 || step > LAST ? (
          <Link
            href={`/app/biens/${lease.propertyId}?onglet=location`}
            className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink"
          >
            <BackIcon />
            {d.location.backToProperty}
          </Link>
        ) : (
          <button
            onClick={() => setStep((s) => s - 1)}
            className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink"
          >
            <BackIcon />
            {d.common.back}
          </button>
        )}
        {step <= LAST && (
          <p className="absolute left-1/2 hidden -translate-x-1/2 text-sm text-ink-soft sm:block">
            {d.biens.wizStepOf.replace("{n}", String(step)).replace("{total}", String(LAST))}
          </p>
        )}
      </div>

      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
        <AnimatePresence mode="wait" initial={false}>
          {step === 1 && (
            <motion.div key="s1" {...slide(-1)}>
              {Heading}
              <Card>
                <Field label={d.departure.endDate} hint={d.departure.endDateHint}>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </Field>
                <p className="mt-3 text-xs leading-relaxed text-ink-soft">{d.departure.dateNote}</p>
                <Next onClick={() => setStep(2)} />
              </Card>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="s2" {...slide(1)}>
              {Heading}
              <Card>
                {lease.hasExitEdl ? (
                  <p className="rounded-xl bg-emerald-50 p-3.5 text-sm font-semibold text-emerald-800">
                    {d.departure.edlDone}
                  </p>
                ) : (
                  <>
                    <p className="text-sm leading-relaxed text-ink-soft">{d.departure.edlHint}</p>
                    <Link
                      href={`/app/biens/etat-des-lieux?bail=${lease.id}&type=exit`}
                      className="tactile mt-4 inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                    >
                      <Icon name="plus" size={15} />
                      {d.departure.edlStart}
                    </Link>
                  </>
                )}
                <div className="mt-6 flex items-center justify-between">
                  <button onClick={() => setStep(3)} className="text-sm font-semibold text-ink-soft hover:text-ink">
                    {d.departure.edlSkip}
                  </button>
                  <Button onClick={() => setStep(3)}>{d.common.next}</Button>
                </div>
              </Card>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div key="s3" {...slide(1)}>
              {Heading}
              <Card>
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
                <Next onClick={() => setStep(4)} />
              </Card>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div key="s4" {...slide(1)}>
              {Heading}
              <Card>
                {lease.outstandingLabel ? (
                  <p className="rounded-xl bg-amber-50 p-3.5 text-sm text-ink">
                    {d.departure.outstandingIs}{" "}
                    <span className="font-display text-base font-bold tabular-nums">{lease.outstandingLabel}</span>
                  </p>
                ) : (
                  <p className="rounded-xl bg-emerald-50 p-3.5 text-sm font-semibold text-emerald-800">
                    {d.departure.outstandingNone}
                  </p>
                )}
                <p className="mt-3 text-xs leading-relaxed text-ink-soft">{d.departure.outstandingNote}</p>
                <Next onClick={() => setStep(5)} />
              </Card>
            </motion.div>
          )}

          {step === 5 && (
            <motion.div key="s5" {...slide(1)}>
              {Heading}
              <Card>
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
                    <Select
                      value={depositOutcome}
                      onChange={(e) => setDepositOutcome(e.target.value as (typeof OUTCOMES)[number])}
                    >
                      {OUTCOMES.map((o) => (
                        <option key={o} value={o}>
                          {d.status.deposit[o]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {(depositOutcome === "released" || depositOutcome === "partially_released") && (
                    <Field label={d.departure.releasedAmount}>
                      <Input
                        inputMode="decimal"
                        className="text-right tabular-nums"
                        value={releasedAmount}
                        onChange={(e) => setReleasedAmount(e.target.value)}
                      />
                    </Field>
                  )}
                  <Field label={d.departure.decompteIssuedOn} hint={d.departure.decompteHint}>
                    <Input type="date" value={decompteIssuedOn} onChange={(e) => setDecompteIssuedOn(e.target.value)} />
                  </Field>
                </div>
                <Next onClick={() => setStep(6)} />
              </Card>
            </motion.div>
          )}

          {step === 6 && (
            <motion.div key="s6" {...slide(1)}>
              {Heading}
              <Card>
                <dl className="divide-y divide-sand-100">
                  {[
                    { k: d.departure.endDate, v: endDate },
                    { k: d.departure.keysReturnedLabel, v: keysReturned ? d.common.yes : d.common.no },
                    { k: d.departure.depositOutcome, v: d.status.deposit[depositOutcome] },
                  ].map((r) => (
                    <div key={r.k} className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0">
                      <dt className="text-sm text-ink-soft">{r.k}</dt>
                      <dd className="text-right text-sm font-semibold text-ink">{r.v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-4 rounded-xl bg-sand-50 px-3.5 py-3 text-sm leading-relaxed text-ink-soft">
                  {d.departure.confirmNote}
                </p>
                {error && (
                  <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                    {error}
                  </p>
                )}
                <div className="mt-6 flex justify-end">
                  <Button
                    loading={saving}
                    onClick={() => {
                      if (real) void confirm();
                      else setStep(LAST + 1);
                    }}
                  >
                    {d.departure.confirm}
                  </Button>
                </div>
              </Card>
            </motion.div>
          )}

          {step > LAST && (
            <motion.div key="done" {...slide(1)} className="mx-auto max-w-xl text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <Icon name="check" size={28} />
              </span>
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="mt-5 font-display text-2xl font-bold tracking-tight text-ink outline-none"
              >
                {d.departure.doneTitle.replace("{tenant}", lease.tenantNames)}
              </h1>
              {real ? (
                <>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">{d.departure.doneBody}</p>
                  {result && result.droppedPeriods > 0 && (
                    <p className="mt-2 text-sm text-ink-soft">
                      {d.departure.doneDropped.replace("{n}", String(result.droppedPeriods))}
                    </p>
                  )}
                </>
              ) : (
                <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                  {notice}
                </p>
              )}
              <div className="mt-6 flex flex-col gap-2.5">
                <Button onClick={() => router.push(`/app/biens/${lease.propertyId}`)}>
                  {d.location.backToProperty}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => router.push(`/app/biens/${lease.propertyId}?onglet=historique`)}
                >
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

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/pro/ui";
import { fmt, type Locale } from "@/lib/i18n/config";
import { formatDate as formatIso } from "@/lib/types";

/**
 * The arrears ladder's next step, as something the desk does and records:
 * a reminder as done on a date, the mise en demeure as sent by registered
 * letter on a date, the AR as received on a date (from which legal effect
 * runs), the justice-de-paix file as put together once that AR is in hand.
 * Every step is written and the page re-reads the ladder; a sample cabinet
 * plays the outcome and writes nothing.
 */
export type ArrearsStep = "friendly" | "formal" | "mise_en_demeure" | "justice_dossier";

export interface ArrearsLabels {
  record: string;
  doneOn: string;
  dispatchedOn: string;
  confirmMed: string;
  arOn: string;
  saveAr: string;
  awaitingAr: string;
  arReceived: string;
  medRecorded: string;
  justiceRecord: string;
  justiceDone: string;
  stepDone: string;
  failed: string;
  already: string;
  needsAr: string;
  sampleConfirmed: string;
}

export default function ArrearsActions({
  leaseId,
  rentPeriodId,
  next,
  awaitingLetter,
  todayISO,
  stageLabel,
  locale,
  writable,
  sampleNote,
  labels,
}: {
  leaseId: string;
  rentPeriodId: string;
  /** The ladder's next step, when it is already due. */
  next: ArrearsStep | null;
  /** A mise en demeure dispatched and still waiting for its AR. */
  awaitingLetter: { id: string; dispatchedOn: string } | null;
  todayISO: string;
  stageLabel: string;
  /** Dates are printed here, in the reader's locale (a function cannot cross into a client component). */
  locale: Locale;
  writable: boolean;
  sampleNote: string | null;
  labels: ArrearsLabels;
}) {
  const router = useRouter();
  const [date, setDate] = useState(todayISO);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const formatDate = (iso: string) => formatIso(iso, locale);

  const call = async (url: string, method: string, body: Record<string, unknown>, onOk: string, onConflict: (code: string | undefined) => string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.status === 401) {
        window.location.assign("/connexion?next=/app/loyers");
        return;
      }
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        setDone(onOk);
        router.refresh();
      } else setError(res.status === 409 ? onConflict(payload.error) : labels.failed);
    } catch {
      setError(labels.failed);
    }
    setBusy(false);
  };

  if (done) {
    return (
      <p role="status" className="mt-2.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
        {done}
      </p>
    );
  }

  const conflict = (code: string | undefined) => (code === "needs_ar" ? labels.needsAr : labels.already);
  const dateField = (label: string, min?: string) => (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{label}</span>
      <Input type="date" value={date} min={min} max={todayISO} onChange={(e) => setDate(e.target.value)} className="w-44 max-sm:w-full" disabled={busy} />
    </label>
  );
  const sampleOnly = (message: string) => {
    setDone(message);
  };

  let content: React.ReactNode = null;
  if (awaitingLetter) {
    content = (
      <>
        <p className="text-xs text-ink-soft">{fmt(labels.awaitingAr, { date: formatDate(awaitingLetter.dispatchedOn) })}</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
          {dateField(labels.arOn, awaitingLetter.dispatchedOn)}
          <Button
            size="sm"
            loading={busy}
            disabled={!date}
            onClick={() => (writable ? call(`/api/lettres/${encodeURIComponent(awaitingLetter.id)}`, "PATCH", { arReceivedOn: date }, fmt(labels.arReceived, { date: formatDate(date) }), conflict) : sampleOnly(fmt(labels.arReceived, { date: formatDate(date) })))}
          >
            {labels.saveAr}
          </Button>
        </div>
      </>
    );
  } else if (next === "friendly" || next === "formal") {
    content = (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
        {dateField(labels.doneOn)}
        <Button
          size="sm"
          variant="secondary"
          loading={busy}
          disabled={!date}
          onClick={() => (writable ? call(`/api/baux/${encodeURIComponent(leaseId)}/relances`, "POST", { stage: next, rentPeriodId, doneOn: date }, fmt(labels.stepDone, { stage: stageLabel, date: formatDate(date) }), conflict) : sampleOnly(fmt(labels.stepDone, { stage: stageLabel, date: formatDate(date) })))}
        >
          {labels.record}
        </Button>
      </div>
    );
  } else if (next === "mise_en_demeure") {
    content = (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
        {dateField(labels.dispatchedOn)}
        <Button
          size="sm"
          loading={busy}
          disabled={!date}
          onClick={() => (writable ? call(`/api/baux/${encodeURIComponent(leaseId)}/relances`, "POST", { stage: next, rentPeriodId, doneOn: date }, fmt(labels.medRecorded, { date: formatDate(date) }), conflict) : sampleOnly(labels.sampleConfirmed))}
        >
          {labels.confirmMed}
        </Button>
      </div>
    );
  } else if (next === "justice_dossier") {
    content = (
      <Button
        size="sm"
        variant="secondary"
        loading={busy}
        onClick={() => (writable ? call(`/api/baux/${encodeURIComponent(leaseId)}/relances`, "POST", { stage: next, rentPeriodId, doneOn: todayISO }, fmt(labels.justiceDone, { date: formatDate(todayISO) }), conflict) : sampleOnly(fmt(labels.justiceDone, { date: formatDate(todayISO) })))}
      >
        {labels.justiceRecord}
      </Button>
    );
  }
  if (!content) return null;

  return (
    <div className="mt-2.5" data-arrears-actions={rentPeriodId}>
      {content}
      {error && (
        <p role="alert" className="mt-2 text-xs font-semibold text-red-700">
          {error}
        </p>
      )}
      {!writable && sampleNote && <p className="mt-2 text-[11px] text-amber-900/80">{sampleNote}</p>}
    </div>
  );
}

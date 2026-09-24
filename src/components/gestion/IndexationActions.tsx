"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Modal, Select } from "@/components/pro/ui";
import { fmt, type Locale } from "@/lib/i18n/config";
import { euros, formatDate, formatMonth } from "@/lib/types";
import { callJson } from "./call";

/**
 * The residential adjustment as steps the desk records: the capital investi
 * declared on the lease (the 5 % ceiling is computed from it), the
 * adjustment letter sent by registered post on a date, its AR received on
 * a date, the adjustment applied from the month after that AR. Each step is
 * written and the page re-reads the lease and its letters; a sample cabinet
 * plays the outcome and writes nothing.
 */
export interface IndexationLabels {
  capitalDeclare: string;
  capitalYear: string;
  capitalAmount: string;
  capitalKind: string;
  capitalKindLand: string;
  capitalKindConstruction: string;
  capitalKindImprovement: string;
  capitalAdd: string;
  capitalSave: string;
  capitalSaved: string;
  capitalInvalid: string;
  capitalFailed: string;
  capitalRemove: string;
  letterSend: string;
  letterSentOn: string;
  letterSent: string;
  letterAwaiting: string;
  letterArOn: string;
  letterArSave: string;
  letterArSaved: string;
  apply: string;
  applied: string;
  applyNeedsAr: string;
  failed: string;
  refused: string;
  already: string;
  lagRemind: string;
  lagReminded: string;
  close: string;
}

export type LetterStep = { kind: "none" } | { kind: "awaiting_ar"; letterId: string; dispatchedOn: string } | { kind: "ar_received"; effectiveFrom: string };

interface CapitalDraft {
  year: string;
  amount: string;
  kind: "land" | "construction" | "improvement";
}

const BACK = "/app/indexation";

export function CapitalEditor({
  leaseId,
  components,
  todayISO,
  writable,
  sampleNote,
  labels,
}: {
  leaseId: string;
  components: Array<{ year: number; amount: number; kind: "land" | "construction" | "improvement" }>;
  todayISO: string;
  writable: boolean;
  sampleNote: string | null;
  labels: IndexationLabels;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CapitalDraft[]>(
    components.length > 0
      ? components.map((c) => ({ year: String(c.year), amount: (c.amount / 100).toFixed(2).replace(".", ","), kind: c.kind }))
      : [{ year: todayISO.slice(0, 4), amount: "", kind: "construction" }],
  );
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setRow = (i: number, patch: Partial<CapitalDraft>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setError(null);
    if (!writable) {
      setNote(labels.capitalSaved);
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      const res = await callJson(`/api/baux/${encodeURIComponent(leaseId)}`, "PATCH", { capitalComponents: rows.map((r) => ({ year: Number(r.year), amount: r.amount, kind: r.kind })) }, BACK);
      if (!res) return;
      if (res.ok) {
        setNote(labels.capitalSaved);
        setOpen(false);
        router.refresh();
      } else setError(res.status === 400 ? labels.capitalInvalid : labels.capitalFailed);
    } catch {
      setError(labels.capitalFailed);
    }
    setBusy(false);
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-capital-editor={leaseId}>
        {labels.capitalDeclare}
      </Button>
      {note && (
        <p role="status" className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
          {note}
        </p>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={labels.capitalDeclare} closeLabel={labels.close} wide>
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 rounded-xl border border-sand-200 p-3 sm:grid-cols-4 sm:items-end" data-capital-row={i}>
              <Field label={labels.capitalYear}>
                <Input type="number" inputMode="numeric" min={1900} max={Number(todayISO.slice(0, 4))} value={r.year} onChange={(e) => setRow(i, { year: e.target.value })} disabled={busy} />
              </Field>
              <Field label={labels.capitalAmount}>
                <Input value={r.amount} inputMode="decimal" placeholder="0,00" onChange={(e) => setRow(i, { amount: e.target.value })} disabled={busy} />
              </Field>
              <Field label={labels.capitalKind}>
                <Select value={r.kind} onChange={(e) => setRow(i, { kind: e.target.value as CapitalDraft["kind"] })} disabled={busy}>
                  <option value="land">{labels.capitalKindLand}</option>
                  <option value="construction">{labels.capitalKindConstruction}</option>
                  <option value="improvement">{labels.capitalKindImprovement}</option>
                </Select>
              </Field>
              <Button size="sm" variant="ghost" onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))} disabled={busy || rows.length <= 1}>
                {labels.capitalRemove}
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" variant="secondary" onClick={() => setRows((prev) => [...prev, { year: todayISO.slice(0, 4), amount: "", kind: "improvement" }])} disabled={busy || rows.length >= 20}>
            {labels.capitalAdd}
          </Button>
          <Button size="sm" loading={busy} disabled={rows.some((r) => !r.year || !r.amount.trim())} onClick={save}>
            {labels.capitalSave}
          </Button>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-xs font-semibold text-red-700">
            {error}
          </p>
        )}
        {!writable && sampleNote && <p className="mt-3 text-[11px] text-amber-900/80">{sampleNote}</p>}
      </Modal>
    </>
  );
}

/** The letter's three steps: sent, its AR back, the adjustment applied. */
export function AdjustmentSteps({
  leaseId,
  step,
  proposedCents,
  todayISO,
  locale,
  writable,
  sampleNote,
  labels,
}: {
  leaseId: string;
  step: LetterStep;
  proposedCents: number;
  todayISO: string;
  locale: Locale;
  writable: boolean;
  sampleNote: string | null;
  labels: IndexationLabels;
}) {
  const router = useRouter();
  const [date, setDate] = useState(todayISO);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const conflict = (code: unknown) => (code === "already" ? labels.already : code === "needs_ar" ? labels.applyNeedsAr : labels.refused);

  const run = async (url: string, method: string, body: Record<string, unknown>, done: (payload: Record<string, unknown>) => string) => {
    setNote(null);
    if (!writable) {
      setNote(done({}));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await callJson(url, method, body, BACK);
      if (!res) return;
      if (res.ok) {
        setNote(done(res.payload));
        router.refresh();
      } else setError(res.status === 409 ? conflict(res.payload.error) : labels.failed);
    } catch {
      setError(labels.failed);
    }
    setBusy(false);
  };

  const dateField = (label: string, min?: string) => (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{label}</span>
      <Input type="date" value={date} min={min} max={todayISO} onChange={(e) => setDate(e.target.value)} className="w-44 max-sm:w-full" disabled={busy} />
    </label>
  );

  if (note)
    return (
      <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
        {note}
      </p>
    );

  let content: React.ReactNode;
  if (step.kind === "none") {
    content = (
      <div className="flex flex-col items-end gap-2">
        {dateField(labels.letterSentOn)}
        <Button size="sm" loading={busy} disabled={!date} onClick={() => run(`/api/baux/${encodeURIComponent(leaseId)}/indexation/courrier`, "POST", { dispatchedOn: date }, () => fmt(labels.letterSent, { date: formatDate(date, locale) }))}>
          {labels.letterSend}
        </Button>
      </div>
    );
  } else if (step.kind === "awaiting_ar") {
    content = (
      <>
        <p className="max-w-56 text-xs text-ink-soft">{fmt(labels.letterAwaiting, { date: formatDate(step.dispatchedOn, locale) })}</p>
        <div className="mt-2 flex flex-col items-end gap-2">
          {dateField(labels.letterArOn, step.dispatchedOn)}
          <Button
            size="sm"
            loading={busy}
            disabled={!date}
            onClick={() => {
              const [y, m] = date.slice(0, 7).split("-").map(Number);
              const month = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
              return run(`/api/lettres/${encodeURIComponent(step.letterId)}`, "PATCH", { arReceivedOn: date }, () => fmt(labels.letterArSaved, { date: formatDate(date, locale), month: formatMonth(month, locale) }));
            }}
          >
            {labels.letterArSave}
          </Button>
        </div>
      </>
    );
  } else {
    content = (
      <Button
        size="sm"
        loading={busy}
        onClick={() =>
          run(`/api/baux/${encodeURIComponent(leaseId)}/indexation`, "POST", {}, (payload) =>
            fmt(labels.applied, {
              amount: euros(typeof payload.newRentCents === "number" ? payload.newRentCents : proposedCents, locale),
              month: formatMonth(typeof payload.effectiveFrom === "string" ? payload.effectiveFrom : step.effectiveFrom, locale),
              n: typeof payload.repriced === "number" ? payload.repriced : 0,
            }),
          )
        }
      >
        {fmt(labels.apply, { month: formatMonth(step.effectiveFrom, locale) })}
      </Button>
    );
  }
  return (
    <div data-adjustment-steps={leaseId}>
      {content}
      {error && (
        <p role="alert" className="mt-2 text-xs font-semibold text-red-700">
          {error}
        </p>
      )}
      {!writable && sampleNote && <p className="mt-2 max-w-56 text-[11px] text-amber-900/80">{sampleNote}</p>}
    </div>
  );
}

/** The standing-order reminder, posted in the tenancy's conversation. */
export function LagReminder({ leaseId, message, writable, labels }: { leaseId: string; message: string; writable: boolean; labels: IndexationLabels }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!writable) {
      setNote(labels.lagReminded);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await callJson(`/api/baux/${encodeURIComponent(leaseId)}/messages`, "POST", { body: message }, BACK);
      if (!res) return;
      if (res.ok) {
        setNote(labels.lagReminded);
        router.refresh();
      } else setError(labels.failed);
    } catch {
      setError(labels.failed);
    }
    setBusy(false);
  };

  if (note)
    return (
      <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
        {note}
      </p>
    );
  return (
    <>
      <Button size="sm" loading={busy} onClick={send}>
        {labels.lagRemind}
      </Button>
      {error && (
        <p role="alert" className="text-xs font-semibold text-red-700">
          {error}
        </p>
      )}
    </>
  );
}

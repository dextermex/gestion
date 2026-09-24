"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Modal, Select } from "@/components/pro/ui";
import { fmt, type Locale } from "@/lib/i18n/config";
import { euros, formatDate } from "@/lib/types";
import { callJson } from "./call";

/**
 * A charges décompte, entered by the desk and saved as a draft: the lines as
 * the invoices or the syndic's statement give them, the tenant's share the
 * recharge engine decides. Issuing it dates it and carries what the tenant
 * owes onto the ledger. The page re-reads the periods after each write; a
 * sample cabinet plays the outcome and writes nothing.
 */
export interface ChargeLabels {
  newDecompte: string;
  formLease: string;
  formYear: string;
  formLines: string;
  formLabel: string;
  formCategory: string;
  formBuildingTotal: string;
  formTantiemes: string;
  formTantiemesTotal: string;
  formLotShare: string;
  formAddLine: string;
  formRemoveLine: string;
  formSave: string;
  formSaved: string;
  formInvalid: string;
  formExists: string;
  formFailed: string;
  issue: string;
  issued: string;
  issueRefused: string;
  deleteDraft: string;
  draftDeleted: string;
  regularisation: string;
  refundNote: string;
  close: string;
}

interface LineDraft {
  label: string;
  category: string;
  buildingTotal: string;
  tantiemes: string;
  tantiemesTotal: string;
  lotShare: string;
}

const BACK = "/app/charges";
const emptyLine = (category: string): LineDraft => ({ label: "", category, buildingTotal: "", tantiemes: "", tantiemesTotal: "", lotShare: "" });

export function ChargeDecompteForm({
  leases,
  categories,
  defaultYear,
  writable,
  sampleNote,
  labels,
}: {
  leases: Array<{ id: string; label: string }>;
  categories: Array<{ value: string; label: string }>;
  defaultYear: number;
  writable: boolean;
  sampleNote: string | null;
  labels: ChargeLabels;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [leaseId, setLeaseId] = useState(leases[0]?.id ?? "");
  const [year, setYear] = useState(String(defaultYear));
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(categories[0]?.value ?? "other")]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setLine = (i: number, patch: Partial<LineDraft>) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = async () => {
    setError(null);
    if (!writable) {
      setNote(labels.formSaved);
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      const res = await callJson("/api/charges/periodes", "POST", { leaseId, year: Number(year), lines }, BACK);
      if (!res) return;
      if (res.ok) {
        setNote(labels.formSaved);
        setOpen(false);
        setLines([emptyLine(categories[0]?.value ?? "other")]);
        router.refresh();
      } else setError(res.status === 400 ? labels.formInvalid : res.status === 409 ? labels.formExists : labels.formFailed);
    } catch {
      setError(labels.formFailed);
    }
    setBusy(false);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => setOpen(true)} disabled={leases.length === 0}>
          {labels.newDecompte}
        </Button>
        {note && (
          <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
            {note}
          </p>
        )}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={labels.newDecompte} closeLabel={labels.close} wide>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Field label={labels.formLease}>
              <Select value={leaseId} onChange={(e) => setLeaseId(e.target.value)} disabled={busy}>
                {leases.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={labels.formYear}>
            <Input type="number" inputMode="numeric" min={2000} max={defaultYear + 1} value={year} onChange={(e) => setYear(e.target.value)} disabled={busy} />
          </Field>
        </div>
        <p className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">{labels.formLines}</p>
        <div className="space-y-3">
          {lines.map((line, i) => (
            <div key={i} className="rounded-xl border border-sand-200 p-3" data-charge-line={i}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-6">
                <div className="sm:col-span-4">
                  <Field label={labels.formLabel}>
                    <Input value={line.label} maxLength={160} onChange={(e) => setLine(i, { label: e.target.value })} disabled={busy} />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label={labels.formCategory}>
                    <Select value={line.category} onChange={(e) => setLine(i, { category: e.target.value })} disabled={busy}>
                      {categories.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label={labels.formBuildingTotal}>
                    <Input value={line.buildingTotal} inputMode="decimal" placeholder="0,00" onChange={(e) => setLine(i, { buildingTotal: e.target.value })} disabled={busy} />
                  </Field>
                </div>
                <Field label={labels.formTantiemes}>
                  <Input value={line.tantiemes} inputMode="numeric" onChange={(e) => setLine(i, { tantiemes: e.target.value })} disabled={busy} />
                </Field>
                <Field label={labels.formTantiemesTotal}>
                  <Input value={line.tantiemesTotal} inputMode="numeric" onChange={(e) => setLine(i, { tantiemesTotal: e.target.value })} disabled={busy} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label={labels.formLotShare}>
                    <Input value={line.lotShare} inputMode="decimal" placeholder="0,00" onChange={(e) => setLine(i, { lotShare: e.target.value })} disabled={busy} />
                  </Field>
                </div>
              </div>
              {lines.length > 1 && (
                <div className="mt-2 text-right">
                  <Button size="sm" variant="ghost" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))} disabled={busy}>
                    {labels.formRemoveLine}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" variant="secondary" onClick={() => setLines((prev) => [...prev, emptyLine(categories[0]?.value ?? "other")])} disabled={busy || lines.length >= 60}>
            {labels.formAddLine}
          </Button>
          <Button size="sm" loading={busy} disabled={!leaseId || !year} onClick={save}>
            {labels.formSave}
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

/** A draft's two fates: issued (dated, its balance carried onto the ledger), or discarded. */
export function ChargePeriodActions({ periodId, locale, writable, labels }: { periodId: string; locale: Locale; writable: boolean; labels: ChargeLabels }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/charges/periodes/${encodeURIComponent(periodId)}`;

  const run = async (url: string, method: string, done: (payload: Record<string, unknown>) => string) => {
    setNote(null);
    if (!writable) {
      setNote(done({}));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await callJson(url, method, method === "POST" ? {} : undefined, BACK);
      if (!res) return;
      if (res.ok) {
        setNote(done(res.payload));
        router.refresh();
      } else setError(res.status === 409 ? labels.issueRefused : labels.formFailed);
    } catch {
      setError(labels.formFailed);
    }
    setBusy(false);
  };

  const issuedNote = (payload: Record<string, unknown>): string => {
    const issuedOn = typeof payload.issuedOn === "string" ? payload.issuedOn : "";
    const dueOn = typeof payload.dueOn === "string" ? payload.dueOn : "";
    const balance = typeof payload.balanceCents === "number" ? payload.balanceCents : 0;
    const carried = typeof payload.carriedTo === "string" ? payload.carriedTo : null;
    const parts = [fmt(labels.issued, { date: issuedOn ? formatDate(issuedOn, locale) : "", due: dueOn ? formatDate(dueOn, locale) : "" })];
    if (balance > 0 && carried) parts.push(fmt(labels.regularisation, { month: formatDate(`${carried}-01`, locale) }));
    if (balance < 0) parts.push(fmt(labels.refundNote, { amount: euros(-balance, locale) }));
    return parts.join(" ");
  };

  if (note)
    return (
      <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
        {note}
      </p>
    );
  return (
    <div className="flex flex-wrap items-center gap-2" data-charge-period-actions={periodId}>
      <Button size="sm" loading={busy} onClick={() => run(`${base}/emettre`, "POST", issuedNote)}>
        {labels.issue}
      </Button>
      <Button size="sm" variant="ghost" loading={busy} onClick={() => run(base, "DELETE", () => labels.draftDeleted)}>
        {labels.deleteDraft}
      </Button>
      {error && (
        <p role="alert" className="text-xs font-semibold text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

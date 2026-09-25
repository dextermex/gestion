"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Select } from "@/components/pro/ui";
import { fmt, type Locale } from "@/lib/i18n/config";
import { euros, formatDate as formatIso, type DepositStatus } from "@/lib/types";
import { callForm, callJson } from "./call";

/**
 * What the desk does with a guarantee, as writes: received on a date; a
 * retention added to an open restitution, justified by a piece within the
 * month or withdrawn; the décompte issued; a tranche released for the
 * amount the settlement engine computed; the tenant's mise en demeure AR
 * recorded; a dispute declared and closed. The page re-reads the rows after
 * each one. A sample cabinet plays the outcome and writes nothing.
 */
export interface DepositLabels {
  actReceivedOn: string;
  actReceive: string;
  actReceived: string;
  actRetentionTitle: string;
  actRetentionKind: string;
  actRetentionLabel: string;
  actRetentionAmount: string;
  actRetentionAdd: string;
  actRetentionAdded: string;
  actRetentionBlocked: string;
  actJustify: string;
  actJustifyRef: string;
  actJustifyFile: string;
  actJustifyNeedsFile: string;
  actJustifyBadFile: string;
  actJustifyOn: string;
  actJustified: string;
  actJustifyLate: string;
  actRemoveLine: string;
  actRemoved: string;
  actDecompteOn: string;
  actDecompteIssue: string;
  actDecompteIssued: string;
  actReleaseFirst: string;
  actReleaseBalance: string;
  actReleased: string;
  actReleaseNothing: string;
  actMedArOn: string;
  actMedArSave: string;
  actMedArSaved: string;
  actDispute: string;
  actDisputeEnd: string;
  actDisputed: string;
  actFailed: string;
  actRefused: string;
  actAlready: string;
  lineDamage: string;
  lineArrears: string;
  lineReserve: string;
}

const BACK = "/app/garanties";
const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/avif";
const dateInput = (label: string, value: string, set: (v: string) => void, max: string, min?: string, disabled?: boolean) => (
  <label className="block">
    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{label}</span>
    <Input type="date" value={value} min={min} max={max} onChange={(e) => set(e.target.value)} className="w-44 max-sm:w-full" disabled={disabled} />
  </label>
);

function Notice({ note, error }: { note: string | null; error: string | null }) {
  if (note)
    return (
      <p role="status" className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
        {note}
      </p>
    );
  if (error)
    return (
      <p role="alert" className="mt-2 text-xs font-semibold text-red-700">
        {error}
      </p>
    );
  return null;
}

/** A guarantee still pending: the day it was received makes it held. */
export function DepositReceive({ depositId, todayISO, locale, writable, sampleNote, labels }: { depositId: string; todayISO: string; locale: Locale; writable: boolean; sampleNote: string | null; labels: DepositLabels }) {
  const router = useRouter();
  const [date, setDate] = useState(todayISO);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const receive = async () => {
    const done = fmt(labels.actReceived, { date: formatIso(date, locale) });
    if (!writable) {
      setNote(done);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await callJson(`/api/garanties/${encodeURIComponent(depositId)}`, "PATCH", { status: "held", receivedOn: date }, BACK);
      if (!res) return;
      if (res.ok) {
        setNote(done);
        router.refresh();
      } else setError(res.status === 409 ? labels.actRefused : labels.actFailed);
    } catch {
      setError(labels.actFailed);
    }
    setBusy(false);
  };

  if (note) return <Notice note={note} error={null} />;
  return (
    <div className="mt-2" data-deposit-receive={depositId}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
        {dateInput(labels.actReceivedOn, date, setDate, todayISO, undefined, busy)}
        <Button size="sm" loading={busy} disabled={!date} onClick={receive}>
          {labels.actReceive}
        </Button>
      </div>
      <Notice note={null} error={error} />
      {!writable && sampleNote && <p className="mt-2 text-[11px] text-amber-900/80">{sampleNote}</p>}
    </div>
  );
}

/** One retention line: justified by a piece on a date, or withdrawn while it retains nothing. */
export function DepositLineActions({
  depositId,
  lineId,
  lineStatus,
  todayISO,
  writable,
  labels,
}: {
  depositId: string;
  lineId: string;
  lineStatus: "justified" | "pending" | "expired_forfeited" | "blocked_no_entry_edl";
  todayISO: string;
  writable: boolean;
  labels: DepositLabels;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState(todayISO);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (lineStatus === "justified" || lineStatus === "expired_forfeited") return null;
  const base = `/api/garanties/${encodeURIComponent(depositId)}/retenues/${encodeURIComponent(lineId)}`;

  const run = async (method: "PATCH" | "DELETE", body: Record<string, unknown> | undefined, done: string) => {
    if (!writable) {
      setNote(done);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // The piece first, into the register, hanging off this line; then the line, justified by it.
      if (method === "PATCH") {
        if (!file) {
          setError(labels.actJustifyNeedsFile);
          setBusy(false);
          return;
        }
        const form = new FormData();
        form.set("file", file);
        form.set("class", "invoice");
        form.set("name", ref.trim() || file.name);
        form.set("relatedType", "deposit_deduction");
        form.set("relatedId", lineId);
        const stored = await callForm("/api/documents", form, BACK);
        if (!stored) return;
        if (!stored.ok) {
          setError(stored.status === 415 ? labels.actJustifyBadFile : labels.actFailed);
          setBusy(false);
          return;
        }
        body = { ...body, documentId: stored.payload.id };
      }
      const res = await callJson(base, method, body, BACK);
      if (!res) return;
      if (res.ok) {
        setNote(done);
        router.refresh();
      } else if (res.status === 409 && res.payload.error === "expired") {
        setError(labels.actJustifyLate);
        router.refresh();
      } else setError(res.status === 409 ? (res.payload.error === "already" ? labels.actAlready : labels.actRefused) : labels.actFailed);
    } catch {
      setError(labels.actFailed);
    }
    setBusy(false);
  };

  if (note) return <Notice note={note} error={null} />;
  return (
    <div className="mt-2" data-deposit-line={lineId}>
      {open ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
          <label className="block min-w-0 flex-1">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{labels.actJustifyFile}</span>
            <input
              type="file"
              accept={ACCEPT}
              className="block w-full text-sm text-ink file:mr-3 file:rounded-lg file:border file:border-sand-200 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink-soft"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={busy}
            />
          </label>
          <label className="block min-w-0 flex-1">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{labels.actJustifyRef}</span>
            <Input value={ref} maxLength={160} onChange={(e) => setRef(e.target.value)} disabled={busy} />
          </label>
          {dateInput(labels.actJustifyOn, date, setDate, todayISO, undefined, busy)}
          <Button size="sm" loading={busy} disabled={!date || (writable && !file)} onClick={() => run("PATCH", { justifiedOn: date }, labels.actJustified)}>
            {labels.actJustify}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {lineStatus === "pending" && (
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
              {labels.actJustify}
            </Button>
          )}
          <Button size="sm" variant="ghost" loading={busy} onClick={() => run("DELETE", undefined, labels.actRemoved)}>
            {labels.actRemoveLine}
          </Button>
        </div>
      )}
      <Notice note={null} error={error} />
    </div>
  );
}

/** The restitution's moves: a retention, the décompte, the two tranches, the tenant's mise en demeure, the dispute. */
export function DepositSettlementActions({
  depositId,
  status,
  keyHandoverOn,
  decompteIssuedOn,
  miseEnDemeureArOn,
  firstTrancheCents,
  balanceCents,
  releasedFirstTrancheCents,
  todayISO,
  locale,
  writable,
  sampleNote,
  labels,
}: {
  depositId: string;
  status: DepositStatus;
  keyHandoverOn: string;
  decompteIssuedOn: string | null;
  miseEnDemeureArOn: string | null;
  /** What the first tranche would release now (zero once released, or when nothing is due). */
  firstTrancheCents: number;
  /** What the balance would release now (zero until the décompte, once released, or when nothing is due). */
  balanceCents: number;
  releasedFirstTrancheCents: number;
  todayISO: string;
  locale: Locale;
  writable: boolean;
  sampleNote: string | null;
  labels: DepositLabels;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retention, setRetention] = useState(false);
  const [kind, setKind] = useState<"arrears" | "damage" | "charge_reserve">("arrears");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [decompteOn, setDecompteOn] = useState(todayISO);
  const [medArOn, setMedArOn] = useState(todayISO);
  const base = `/api/garanties/${encodeURIComponent(depositId)}`;
  const conflict = (code: unknown) => (code === "already" ? labels.actAlready : code === "nothing" ? labels.actReleaseNothing : labels.actRefused);

  const run = async (url: string, method: string, body: Record<string, unknown>, done: string | ((payload: Record<string, unknown>) => string)) => {
    setNote(null);
    if (!writable) {
      setNote(typeof done === "string" ? done : done({}));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await callJson(url, method, body, BACK);
      if (!res) return;
      if (res.ok) {
        setNote(typeof done === "string" ? done : done(res.payload));
        router.refresh();
      } else setError(res.status === 409 ? conflict(res.payload.error) : labels.actFailed);
    } catch {
      setError(labels.actFailed);
    }
    setBusy(false);
  };

  const addRetention = () =>
    run(`${base}/retenues`, "POST", { kind, label: label.trim(), amount: amount.trim() }, (payload) => {
      setRetention(false);
      setLabel("");
      setAmount("");
      return payload.status === "blocked_no_entry_edl" ? `${labels.actRetentionAdded} ${labels.actRetentionBlocked}` : labels.actRetentionAdded;
    });

  return (
    <div className="mt-4 space-y-3" data-deposit-actions={depositId}>
      <div className="rounded-xl border border-sand-200 p-3">
        {retention ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4 sm:items-end">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{labels.actRetentionKind}</span>
              <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} disabled={busy}>
                <option value="arrears">{labels.lineArrears}</option>
                <option value="damage">{labels.lineDamage}</option>
                <option value="charge_reserve">{labels.lineReserve}</option>
              </Select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{labels.actRetentionLabel}</span>
              <Input value={label} maxLength={160} onChange={(e) => setLabel(e.target.value)} disabled={busy} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{labels.actRetentionAmount}</span>
              <Input value={amount} inputMode="decimal" placeholder="0,00" onChange={(e) => setAmount(e.target.value)} disabled={busy} />
            </label>
            <Button size="sm" loading={busy} disabled={!label.trim() || !amount.trim()} onClick={addRetention}>
              {labels.actRetentionAdd}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setRetention(true)}>
            {labels.actRetentionTitle}
          </Button>
        )}
      </div>

      {!decompteIssuedOn && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
          {dateInput(labels.actDecompteOn, decompteOn, setDecompteOn, todayISO, keyHandoverOn, busy)}
          <Button size="sm" variant="secondary" loading={busy} disabled={!decompteOn} onClick={() => run(base, "PATCH", { decompteIssuedOn: decompteOn }, fmt(labels.actDecompteIssued, { date: formatIso(decompteOn, locale) }))}>
            {labels.actDecompteIssue}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {firstTrancheCents > 0 && (
          <Button size="sm" loading={busy} onClick={() => run(`${base}/liberation`, "POST", { tranche: "first" }, fmt(labels.actReleased, { amount: euros(firstTrancheCents, locale) }))}>
            {fmt(labels.actReleaseFirst, { amount: euros(firstTrancheCents, locale) })}
          </Button>
        )}
        {balanceCents > 0 && (
          <Button size="sm" loading={busy} onClick={() => run(`${base}/liberation`, "POST", { tranche: "balance" }, fmt(labels.actReleased, { amount: euros(balanceCents, locale) }))}>
            {fmt(labels.actReleaseBalance, { amount: euros(balanceCents, locale) })}
          </Button>
        )}
        {firstTrancheCents === 0 && balanceCents === 0 && <p className="self-center text-xs text-ink-soft">{labels.actReleaseNothing}</p>}
        {status === "disputed" ? (
          <Button size="sm" variant="ghost" loading={busy} onClick={() => run(base, "PATCH", { status: releasedFirstTrancheCents > 0 ? "partially_released" : "release_pending" }, labels.actDisputed)}>
            {labels.actDisputeEnd}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" loading={busy} onClick={() => run(base, "PATCH", { status: "disputed" }, labels.actDisputed)}>
            {labels.actDispute}
          </Button>
        )}
      </div>

      {!miseEnDemeureArOn && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
          {dateInput(labels.actMedArOn, medArOn, setMedArOn, todayISO, keyHandoverOn, busy)}
          <Button size="sm" variant="ghost" loading={busy} disabled={!medArOn} onClick={() => run(base, "PATCH", { miseEnDemeureArOn: medArOn }, fmt(labels.actMedArSaved, { date: formatIso(medArOn, locale) }))}>
            {labels.actMedArSave}
          </Button>
        </div>
      )}

      <Notice note={note} error={error} />
      {!writable && sampleNote && <p className="text-[11px] text-amber-900/80">{sampleNote}</p>}
    </div>
  );
}

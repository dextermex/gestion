"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Field, Input } from "@/components/pro/ui";

/**
 * The payments received on a tenancy, each with the one correction the
 * ledger allows: cancelling it. A cancelled payment stays in the list,
 * struck through, with the day it was cancelled; its months are due again.
 * Every figure and label arrives worded from the server.
 */
export interface PaymentRow {
  id: string;
  date: string;
  amount: string;
  /** "Saisi à la main" or "Rapproché de la banque". */
  origin: string;
  /** "dont … en crédit", when part of it sits on no period yet. */
  credit: string | null;
  /** "Annulé le …", when it was. */
  cancelled: string | null;
  note: string | null;
}

export interface PaymentsLabels {
  empty: string;
  cancel: string;
  cancelTitle: string;
  cancelBody: string;
  cancelReason: string;
  cancelDo: string;
  cancelKeep: string;
  cancelFailed: string;
  receiptIssued: string;
}

export default function PaymentsPanel({ rows, labels, real }: { rows: PaymentRow[]; labels: PaymentsLabels; real: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = (id: string) => {
    setOpen(id);
    setReason("");
    setError(null);
  };

  async function cancel(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/paiements/${id}/annulation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (res.status === 409) {
        setError(labels.receiptIssued);
        return;
      }
      if (!res.ok) {
        setError(labels.cancelFailed);
        return;
      }
      setOpen(null);
      router.refresh();
    } catch {
      setError(labels.cancelFailed);
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) return <p className="text-sm text-ink-soft">{labels.empty}</p>;

  return (
    <ul className="divide-y divide-sand-100">
      {rows.map((p) => (
        <li key={p.id} className="py-2.5 text-sm" data-payment={p.id}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className={"min-w-0 flex-1 " + (p.cancelled ? "text-ink-soft line-through" : "text-ink")}>
              {p.date}
              <span className="ml-2 text-xs text-ink-soft no-underline">{p.origin}</span>
            </p>
            <p className={"tabular-nums " + (p.cancelled ? "text-ink-soft line-through" : "font-semibold text-ink")}>{p.amount}</p>
            {p.cancelled ? (
              <Badge className="bg-sand-100 text-ink-soft">{p.cancelled}</Badge>
            ) : (
              real &&
              open !== p.id && (
                <button
                  type="button"
                  onClick={() => start(p.id)}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-ink-soft transition hover:bg-sand-100 hover:text-ink max-sm:min-h-10"
                >
                  {labels.cancel}
                </button>
              )
            )}
          </div>
          {(p.credit || p.note) && !p.cancelled && (
            <p className="mt-0.5 text-xs text-ink-soft">{[p.credit, p.note].filter(Boolean).join(" · ")}</p>
          )}
          {open === p.id && (
            <div className="mt-3 rounded-xl bg-sand-50 p-3.5">
              <p className="text-sm font-semibold text-ink">{labels.cancelTitle}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">{labels.cancelBody}</p>
              <div className="mt-3">
                <Field label={labels.cancelReason}>
                  <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
                </Field>
              </div>
              {error && (
                <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                  {error}
                </p>
              )}
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button variant="ghost" disabled={busy} onClick={() => setOpen(null)}>
                  {labels.cancelKeep}
                </Button>
                <Button variant="danger" loading={busy} onClick={() => void cancel(p.id)}>
                  {labels.cancelDo}
                </Button>
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

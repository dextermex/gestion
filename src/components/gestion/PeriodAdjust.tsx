"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/pro/ui";

/**
 * One month's amount, set by hand from the tenancy's sheet: cut to the days
 * the tenancy covers when it began or ends during the month, or stated with
 * a reason. Offered on a month nothing was paid on; the API keeps the rules.
 * Every label and amount arrives worded from the server.
 */
export interface PeriodAdjustLabels {
  adjust: string;
  rent: string;
  charges: string;
  reason: string;
  save: string;
  cancel: string;
  failed: string;
  paid: string;
  already: string;
  invalid: string;
}

export default function PeriodAdjust({
  leaseId,
  periodId,
  rent,
  charges,
  prorata,
  labels,
}: {
  leaseId: string;
  periodId: string;
  /** The month's amounts as the form opens on them (euros, as typed). */
  rent: string;
  charges: string;
  /** The button that cuts the month to its days, worded ("12 jours sur 30, 560,00 €"); null when the tenancy covers the whole month. */
  prorata: string | null;
  labels: PeriodAdjustLabels;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rentValue, setRent] = useState(rent);
  const [chargesValue, setCharges] = useState(charges);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/baux/${encodeURIComponent(leaseId)}/echeances/${encodeURIComponent(periodId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const answer = (await res.json().catch(() => ({}))) as { error?: string };
        setError(answer.error === "paid" ? labels.paid : answer.error === "already_adjusted" ? labels.already : answer.error === "invalid" ? labels.invalid : labels.failed);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError(labels.failed);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setRent(rent);
          setCharges(charges);
          setReason("");
          setError(null);
        }}
        className="inline-flex min-h-10 items-center text-xs font-semibold text-brand-700 hover:underline"
      >
        {labels.adjust}
      </button>
    );
  }
  return (
    <div className="basis-full rounded-xl bg-sand-50 p-3.5" data-period-adjust={periodId}>
      {prorata && (
        <Button variant="secondary" size="sm" loading={busy} onClick={() => void send({ prorata: true })}>
          {prorata}
        </Button>
      )}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={labels.rent}>
          <Input inputMode="decimal" value={rentValue} onChange={(e) => setRent(e.target.value)} />
        </Field>
        <Field label={labels.charges}>
          <Input inputMode="decimal" value={chargesValue} onChange={(e) => setCharges(e.target.value)} />
        </Field>
        <div className="min-w-0 sm:col-span-2">
          <Field label={labels.reason}>
            <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          {labels.cancel}
        </Button>
        <Button loading={busy} disabled={reason.trim() === ""} onClick={() => void send({ rent: rentValue, charges: chargesValue, reason })}>
          {labels.save}
        </Button>
      </div>
    </div>
  );
}

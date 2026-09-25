"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/pro/ui";
import { fmt, type Locale } from "@/lib/i18n/config";
import { formatDate } from "@/lib/types";
import { callJson } from "./call";

/** A bill paid today: written on the row, the page re-reads the books. */
export default function BillActions({
  billId,
  todayISO,
  locale,
  writable,
  labels,
}: {
  billId: string;
  todayISO: string;
  locale: Locale;
  writable: boolean;
  labels: { markPaid: string; markedPaid: string; failed: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const markPaid = async () => {
    const done = fmt(labels.markedPaid, { date: formatDate(todayISO, locale) });
    if (!writable) {
      setNote(done);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await callJson(`/api/finance/factures/${encodeURIComponent(billId)}`, "PATCH", { paidOn: todayISO }, "/app/finance");
      if (!res) return;
      if (res.ok) {
        setNote(done);
        router.refresh();
      } else setError(labels.failed);
    } catch {
      setError(labels.failed);
    }
    setBusy(false);
  };

  if (note)
    return (
      <p role="status" className="text-xs font-semibold text-emerald-800">
        {note}
      </p>
    );
  return (
    <>
      <Button size="sm" variant="secondary" loading={busy} onClick={markPaid} data-bill-paid={billId}>
        {labels.markPaid}
      </Button>
      {error && (
        <p role="alert" className="mt-1 text-xs font-semibold text-red-700">
          {error}
        </p>
      )}
    </>
  );
}

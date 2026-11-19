"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/pro/ui";

/**
 * "Supprimer mon compte": the request, its confirmation, and the way back.
 *
 * The request is recorded on the account with its date and the team
 * completes it: nothing is erased from this screen, because leases and
 * accounts carry retention duties a person has to review. While a request
 * is pending the screen says so, with its date, and offers to withdraw it.
 */
export interface DeletionLabels {
  body: string;
  action: string;
  confirmTitle: string;
  confirmBody: string;
  confirm: string;
  cancel: string;
  pending: string;
  restore: string;
  failed: string;
  sampleNote: string | null;
}

export default function AccountDeletion({ requested, labels }: { requested: boolean; labels: DeletionLabels }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [sample, setSample] = useState(false);

  const send = async (action: "delete" | "restore") => {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/compte", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; sample?: boolean };
      if (!res.ok || !json.ok) setError(true);
      else if (json.sample) setSample(true);
      else router.refresh();
    } catch {
      setError(true);
    }
    setAsking(false);
    setBusy(false);
  };

  if (requested) {
    return (
      <div data-account-deletion="pending">
        <p role="status" className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">{labels.pending}</p>
        <Button variant="secondary" size="sm" className="mt-3 max-sm:min-h-11" onClick={() => send("restore")} disabled={busy}>
          {labels.restore}
        </Button>
        {error && <p role="alert" className="mt-2 text-sm font-medium text-red-700">{labels.failed}</p>}
      </div>
    );
  }

  return (
    <div data-account-deletion="idle">
      <p className="text-sm leading-relaxed text-ink-soft">{labels.body}</p>
      {asking ? (
        <div role="group" aria-label={labels.confirmTitle} className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-900">{labels.confirmTitle}</p>
          <p className="mt-1 text-sm leading-relaxed text-red-900">{labels.confirmBody}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="danger" size="sm" className="max-sm:min-h-11" onClick={() => send("delete")} disabled={busy}>
              {labels.confirm}
            </Button>
            <Button variant="ghost" size="sm" className="max-sm:min-h-11" onClick={() => setAsking(false)} disabled={busy}>
              {labels.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAsking(true)}
          className="mt-3 inline-flex min-h-10 items-center rounded-xl border border-red-200 bg-white px-3.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 max-sm:min-h-11"
        >
          {labels.action}
        </button>
      )}
      {sample && labels.sampleNote && <p role="status" className="mt-2 text-sm font-medium text-brand-800">{labels.sampleNote}</p>}
      {error && <p role="alert" className="mt-2 text-sm font-medium text-red-700">{labels.failed}</p>}
    </div>
  );
}

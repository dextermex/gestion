"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/pro/ui";

/**
 * What an owner can do with a rental dossier in preparation. Resuming
 * reopens the guided flow at its first incomplete step; activating makes it
 * the tenancy in force (the lot is occupied, the ledger opens) and is only
 * offered once the dossier names someone and a rent; discarding removes a
 * dossier that carries nothing. All three change the database, never the
 * screen alone. A sample cabinet can only resume: it has nothing to persist.
 */

type Labels = {
  resume: string;
  activate: string;
  activateIncomplete: string;
  discard: string;
  discardConfirm: string;
  confirm: string;
  cancel: string;
  activateFailed: string;
  discardBlocked: string;
  failed: string;
};

export default function DraftDossierActions({
  leaseId,
  propertyId,
  real,
  ready,
  labels,
}: {
  leaseId: string;
  propertyId: string;
  real: boolean;
  /** Someone is named and a rent is set: the dossier may become a tenancy. */
  ready: boolean;
  labels: Labels;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"activate" | "discard" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (action: "activate" | "discard") => {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/baux/${leaseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        setConfirming(false);
        router.refresh();
        if (action === "activate") router.push(`/app/biens/${propertyId}?onglet=location`);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (action === "discard" && data.error === "not_empty") setError(labels.discardBlocked);
      else if (action === "activate" && data.error === "incomplete") setError(labels.activateIncomplete);
      else setError(action === "activate" ? labels.activateFailed : labels.failed);
    } catch {
      setError(labels.failed);
    }
    setBusy(null);
  };

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/app/biens/locataire?bail=${encodeURIComponent(leaseId)}`}
          className="tactile inline-flex min-h-9 items-center rounded-xl bg-brand-600 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          {labels.resume}
        </Link>
        {real && !confirming && (
          <>
            <Button
              size="sm"
              variant="secondary"
              loading={busy === "activate"}
              disabled={busy !== null || !ready}
              title={ready ? undefined : labels.activateIncomplete}
              onClick={() => act("activate")}
            >
              {labels.activate}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setConfirming(true)}>
              {labels.discard}
            </Button>
          </>
        )}
      </div>
      {real && !ready && <p className="mt-2 text-xs text-ink-soft">{labels.activateIncomplete}</p>}
      {real && confirming && (
        <div className="mt-3 rounded-xl border border-sand-200 bg-sand-50 p-3.5">
          <p className="text-sm text-ink">{labels.discardConfirm}</p>
          <div className="mt-2.5 flex gap-2">
            <Button size="sm" variant="danger" loading={busy === "discard"} disabled={busy !== null} onClick={() => act("discard")}>
              {labels.confirm}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => setConfirming(false)}>
              {labels.cancel}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2.5 text-sm font-semibold text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

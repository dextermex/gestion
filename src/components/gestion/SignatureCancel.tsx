"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal } from "@/components/pro/ui";
import type { Dict } from "@/lib/i18n/fr";

/** "Cancel the sending", confirmed first: the signers lose their link, a new sending stays possible. */
export default function SignatureCancel({ d, envelopeId }: { d: Dict; envelopeId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/signature/annuler", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ envelopeId }) });
      if (res.ok || res.status === 409) {
        setOpen(false);
        router.refresh();
        return;
      }
      setError(d.contrats.errGeneric);
    } catch {
      setError(d.contrats.errGeneric);
    }
    setBusy(false);
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setError(null);
          setBusy(false);
          setOpen(true);
        }}
        data-signature-cancel={envelopeId}
      >
        {d.contrats.sigCancel}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={d.contrats.sigCancel} closeLabel={d.common.close}>
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-ink-soft">{d.contrats.sigCancelConfirm}</p>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {d.contrats.sigCancelKeep}
            </Button>
            <Button type="button" variant="danger" loading={busy} onClick={confirm}>
              {d.contrats.sigCancel}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/pro/ui";
import type { DocumentKind } from "@/lib/documents/kinds";
import { callJson } from "./call";

/**
 * One document of the workspace, from one record: the control that asks
 * the register for it (or a new version of it) and, once it exists, opens
 * it through its signed address. Every refusal is said in the person's
 * language, from the code the route answered. A sample cabinet plays the
 * outcome and produces nothing.
 */
export interface GenerateLabels {
  produce: string;
  produceAgain: string;
  open: string;
  producedOn: string;
  produced: string;
  errTemplate: string;
  errSettings: string;
  errFieldName: string;
  errFieldAddress: string;
  errFieldPayment: string;
  errNotReady: string;
  reasonUnpaid: string;
  reasonKeysOut: string;
  reasonUnsealed: string;
  reasonNoContent: string;
  errFailed: string;
}

export interface ExistingDocument {
  documentId: string;
  name: string;
  producedLabel: string;
}

export default function GenerateDocument({
  kind,
  sourceId,
  label,
  existing,
  writable,
  sampleNote,
  labels,
  backTo,
  compact = false,
}: {
  kind: DocumentKind;
  sourceId: string;
  /** What the control calls the document: the kind's label on this screen. */
  label: string;
  existing: ExistingDocument | null;
  writable: boolean;
  sampleNote: string | null;
  labels: GenerateLabels;
  backTo: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<ExistingDocument | null>(null);
  const doc = fresh ?? existing;

  const explain = (payload: Record<string, unknown>): string => {
    const code = String(payload.error ?? "");
    if (code === "template_not_validated" || code === "no_template") return labels.errTemplate;
    if (code === "settings_incomplete") {
      const names: Record<string, string> = { legalName: labels.errFieldName, address: labels.errFieldAddress, payment: labels.errFieldPayment };
      const missing = Array.isArray(payload.missing) ? (payload.missing as string[]).map((m) => names[m] ?? m) : [];
      return labels.errSettings.replace("{fields}", missing.join(", "));
    }
    if (code === "not_ready") {
      const reasons: Record<string, string> = { unpaid: labels.reasonUnpaid, keys_out: labels.reasonKeysOut, unsealed: labels.reasonUnsealed, no_content: labels.reasonNoContent };
      return labels.errNotReady.replace("{reason}", reasons[String(payload.reason)] ?? String(payload.reason ?? ""));
    }
    return labels.errFailed;
  };

  const produce = async (force: boolean) => {
    setError(null);
    setNote(null);
    if (!writable) {
      setNote(sampleNote ?? "");
      return;
    }
    setBusy(true);
    try {
      const res = await callJson("/api/documents/generer", "POST", { kind, sourceId, force }, backTo);
      if (!res) return;
      if (res.ok) {
        const name = String(res.payload.name ?? label);
        setFresh({ documentId: String(res.payload.documentId), name, producedLabel: "" });
        setNote(labels.produced.replace("{name}", name));
        router.refresh();
      } else setError(explain(res.payload));
    } catch {
      setError(labels.errFailed);
    }
    setBusy(false);
  };

  return (
    <div className={compact ? "inline-flex flex-wrap items-center gap-2" : "flex flex-wrap items-center gap-2"} data-doc-kind={kind} data-doc-source={sourceId}>
      {doc ? (
        <>
          <a
            href={`/api/documents/${encodeURIComponent(doc.documentId)}/fichier`}
            className="inline-flex min-h-9 items-center rounded-lg border border-sand-200 bg-white px-3 text-xs font-semibold text-brand-700 hover:border-brand-300 hover:underline"
            data-doc-open={doc.documentId}
          >
            {label} · {labels.open}
          </a>
          {doc.producedLabel && <span className="text-[11px] text-ink-soft">{doc.producedLabel}</span>}
          <Button size="sm" variant="ghost" loading={busy} onClick={() => produce(true)}>
            {labels.produceAgain}
          </Button>
        </>
      ) : (
        <Button size="sm" variant="secondary" loading={busy} onClick={() => produce(false)}>
          {label} · {labels.produce}
        </Button>
      )}
      {note && (
        <span role="status" className="text-[11px] font-semibold text-emerald-800">
          {note}
        </span>
      )}
      {error && (
        <span role="alert" className="text-[11px] font-semibold text-red-700">
          {error}
        </span>
      )}
    </div>
  );
}

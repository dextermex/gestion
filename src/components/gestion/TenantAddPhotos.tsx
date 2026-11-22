"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/pro/icons";
import { PIECE_ACCEPT, pieceLine, preparePieces, sendPieces, type PieceLabels, type PieceOutcome } from "@/lib/portal/pieces";

/**
 * More files for a request already sent (photographs, or a PDF): the same
 * upload as the request form's, to the same route, which stores each file
 * in the lease's own folder under the tenant's token and records it on the
 * request. The database's policy decides (their request, their tenancy in
 * force). One file per request, and every file that did not go is named
 * with its reason.
 */

export default function TenantAddPhotos({
  requestId,
  labels,
  sampleNote,
  compact = false,
}: {
  requestId: string;
  labels: { add: string; uploading: string; added: string; failed: string; someFailed: string; pieces: PieceLabels };
  /** On a sample cabinet, the picker opens but nothing is written. */
  sampleNote: string | null;
  /** Beside the reply field: the camera alone, its label read out, the outcome under it. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "uploading" | "added" | "failed" | "sample">("idle");
  /** What did not go, by name, and how many did. */
  const [refused, setRefused] = useState<PieceOutcome[]>([]);
  const [went, setWent] = useState(0);

  const pick = async (input: HTMLInputElement) => {
    const chosen = Array.from(input.files ?? []);
    input.value = "";
    if (chosen.length === 0) return;
    if (sampleNote) {
      setState("sample");
      return;
    }
    setState("uploading");
    setRefused([]);
    try {
      // Photographs are brought down to upload size first; each file is then ready or refused by name.
      const prepared = await preparePieces(chosen);
      const sent = prepared.ready.length > 0 ? await sendPieces(requestId, prepared.ready) : [];
      if (sent === "signed_out") {
        window.location.assign(`/connexion?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      const failed = [...prepared.refused, ...sent.filter((o) => !o.ok)];
      const ok = sent.filter((o) => o.ok).length;
      setRefused(failed);
      setWent(ok);
      setState(failed.length > 0 ? "failed" : "added");
      if (ok > 0) router.refresh();
    } catch {
      setState("failed");
    }
  };

  // What is said under the control: all went, some did not (which, and why), or nothing went at all.
  const lines = refused.map((o) => pieceLine(o, labels.pieces));
  const outcome =
    state === "added"
      ? labels.added
      : state === "sample"
        ? sampleNote
        : state === "failed"
          ? lines.length === 0
            ? labels.failed
            : went > 0
              ? [labels.someFailed.replace("{sent}", String(went)).replace("{failed}", String(lines.length)), ...lines].join(" ")
              : lines.join(" ")
          : "";
  const outcomeClass = state === "failed" ? "text-red-700" : state === "sample" ? "rounded-lg bg-amber-50 px-2 py-1 text-amber-900" : "text-emerald-800";

  if (compact) {
    return (
      <div className="relative shrink-0">
        <label
          title={labels.add}
          className={
            "tactile flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-sand-200 bg-white text-brand-700 transition hover:border-brand-300 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600 " +
            (state === "uploading" ? "pointer-events-none opacity-60" : "")
          }
        >
          <Icon name="camera" size={20} className="shrink-0" />
          <span className="sr-only">{state === "uploading" ? labels.uploading : labels.add}</span>
          <input type="file" accept={PIECE_ACCEPT} multiple className="sr-only" disabled={state === "uploading"} onChange={(e) => void pick(e.currentTarget)} />
        </label>
        <p role="status" className={"absolute left-0 top-full mt-1.5 w-max max-w-[70vw] text-xs font-semibold " + (outcome ? outcomeClass : "")}>
          {outcome}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <label
        className={
          "tactile inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-sand-200 bg-white px-3.5 text-sm font-semibold text-brand-700 shadow-sm transition hover:border-brand-300 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600 " +
          (state === "uploading" ? "pointer-events-none opacity-60" : "")
        }
      >
        <Icon name="camera" size={18} className="shrink-0" />
        {state === "uploading" ? labels.uploading : labels.add}
        <input type="file" accept={PIECE_ACCEPT} multiple className="sr-only" disabled={state === "uploading"} onChange={(e) => void pick(e.currentTarget)} />
      </label>
      <p role="status" className={"min-h-4 text-right text-xs font-semibold " + outcomeClass}>
        {outcome}
      </p>
    </div>
  );
}

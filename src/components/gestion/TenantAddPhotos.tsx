"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/pro/icons";
import { shrinkPhotos } from "@/lib/photo";

/**
 * More photos for a request already sent: the same upload as the request
 * form's, to the same route, which stores each file in the lease's own
 * folder under the tenant's token and records it on the request. The
 * database's policy decides (their request, their tenancy in force).
 */
const MAX_FILES = 5;
const MAX_BYTES = 8 * 1024 * 1024;

export default function TenantAddPhotos({
  requestId,
  labels,
  sampleNote,
}: {
  requestId: string;
  labels: { add: string; uploading: string; added: string; failed: string };
  /** On a sample cabinet, the picker opens but nothing is written. */
  sampleNote: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "uploading" | "added" | "failed" | "sample">("idle");

  const pick = async (input: HTMLInputElement) => {
    const chosen = Array.from(input.files ?? []).filter((f) => f.type.startsWith("image/")).slice(0, MAX_FILES);
    input.value = "";
    if (chosen.length === 0) return;
    if (sampleNote) {
      setState("sample");
      return;
    }
    setState("uploading");
    try {
      // Brought down to the upload size first: a phone's photograph is well over the limit as taken.
      const ready = (await shrinkPhotos(chosen)).filter((f) => f.size <= MAX_BYTES);
      if (ready.length === 0) {
        setState("failed");
        return;
      }
      const body = new FormData();
      for (const f of ready) body.append("files", f);
      const res = await fetch(`/api/locataire/demandes/${encodeURIComponent(requestId)}/pieces`, { method: "POST", body });
      if (res.status === 401) {
        window.location.assign(`/connexion?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      if (!res.ok) {
        setState("failed");
        return;
      }
      setState("added");
      router.refresh();
    } catch {
      setState("failed");
    }
  };

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
        <input type="file" accept="image/*" multiple className="sr-only" disabled={state === "uploading"} onChange={(e) => void pick(e.currentTarget)} />
      </label>
      <p role="status" className={"min-h-4 text-right text-xs font-semibold " + (state === "failed" ? "text-red-700" : state === "sample" ? "rounded-lg bg-amber-50 px-2 py-1 text-amber-900" : "text-emerald-800")}>
        {state === "added" ? labels.added : state === "failed" ? labels.failed : state === "sample" ? sampleNote : ""}
      </p>
    </div>
  );
}

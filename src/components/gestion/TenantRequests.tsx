"use client";

import { useEffect, useState } from "react";
import { shrinkPhotos } from "@/lib/photo";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Modal, Select, Textarea } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import type { RequestLabels } from "@/lib/portal/labels";
import { REQUEST_KINDS, TECHNICAL_CATEGORIES, type RequestKind } from "@/lib/portal/types";

/**
 * A new request, in two steps: what it is about (a technical problem, a
 * document, a question, anything else), then the few details that let the
 * manager act. A technical problem lands as an intervention in its
 * category; photos travel with it. The request is written through the API
 * under the tenant's own session and the page then reads it back.
 *
 * A link elsewhere in the space may open the form already on its way
 * (`preset`): sending the insurance certificate, asking for a month's
 * receipt, asking for a correction to the file. It is the same request,
 * with its kind and subject filled in and a line saying what to add; the
 * tenant can still go back and choose otherwise.
 */

export interface RequestPreset {
  kind: RequestKind;
  title: string;
  /** The dialog's heading while the preset stands ("Envoyer mon attestation"). */
  heading: string;
  hint: string | null;
}


const MAX_FILES = 5;
const MAX_BYTES = 8 * 1024 * 1024;

export default function TenantRequests({
  labels,
  canCreate,
  sampleNote,
  initialOpen = false,
  preset = null,
}: {
  labels: RequestLabels;
  /** The tenant has a tenancy in force: a request has somewhere to land. */
  canCreate: boolean;
  /** On a sample cabinet, the form is shown but nothing is written. */
  sampleNote: string | null;
  initialOpen?: boolean;
  preset?: RequestPreset | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen);
  const [kind, setKind] = useState<RequestKind | null>(preset?.kind ?? null);
  /** The preset stands until the tenant goes back to choose another kind, or closes the form. */
  const [guided, setGuided] = useState(preset !== null);
  const [category, setCategory] = useState<string>("heating");
  const [severity, setSeverity] = useState<"routine" | "priority" | "urgent">("routine");
  const [title, setTitle] = useState(preset?.title ?? "");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [state, setState] = useState<"idle" | "sending" | "uploading" | "failed" | "noLease" | "sample">("idle");

  useEffect(() => {
    if (initialOpen) setOpen(true);
  }, [initialOpen]);

  const reset = () => {
    setGuided(false);
    setKind(null);
    setCategory("heating");
    setSeverity("routine");
    setTitle("");
    setDescription("");
    setFiles([]);
    setState("idle");
  };
  const close = () => {
    setOpen(false);
    reset();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kind) return;
    if (sampleNote) {
      setState("sample");
      return;
    }
    setState("sending");
    try {
      const res = await fetch("/api/locataire/demandes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, category: kind === "technical" ? category : null, severity: kind === "technical" ? severity : "routine", title, description }),
      });
      if (res.status === 401) {
        window.location.assign(`/connexion?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string; id?: string };
      if (!res.ok || !data.id) {
        setState(data.error === "no_live_lease" ? "noLease" : "failed");
        return;
      }
      if (files.length > 0) {
        setState("uploading");
        const body = new FormData();
        for (const f of files) body.append("files", f);
        // Photos that fail to upload do not undo the request: it exists, the owner has it.
        await fetch(`/api/locataire/demandes/${data.id}/pieces`, { method: "POST", body }).catch(() => null);
      }
      setOpen(false);
      router.push(`/locataire/demandes/${data.id}`);
      router.refresh();
    } catch {
      setState("failed");
    }
  };

  const pickFiles = (list: FileList | null) => {
    // Brought down to the upload size first: a phone's photograph is well over the limit as taken.
    const chosen = Array.from(list ?? []).filter((f) => f.type.startsWith("image/")).slice(0, MAX_FILES);
    void shrinkPhotos(chosen).then((ready) => setFiles(ready.filter((f) => f.size <= MAX_BYTES)));
  };

  if (!canCreate) return null;

  return (
    <>
      <Button onClick={() => setOpen(true)}>{labels.open}</Button>
      <Modal open={open} onClose={close} title={kind ? (guided && preset ? preset.heading : labels.kinds[kind][0]) : labels.open} closeLabel={labels.close}>
        {!kind ? (
          <div>
            <p className="mb-3 text-sm text-ink-soft">{labels.kind}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {REQUEST_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className="request-kind-card tactile rounded-2xl border border-sand-200 bg-white p-4 text-left shadow-sm transition hover:border-brand-200 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                >
                  <span className="crm-symbol"><Icon name={k === "technical" ? "tasks" : k === "document" ? "documents" : k === "question" ? "messages" : "inbox"} size={24}/></span>
                  <p className="font-display text-base font-bold text-ink">{labels.kinds[k][0]}</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-soft">{labels.kinds[k][1]}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={submit}>
            {guided && preset?.hint && <p className="rounded-xl bg-brand-50 px-3.5 py-2.5 text-sm leading-relaxed text-ink">{preset.hint}</p>}
            {kind === "technical" && (
              <>
                <Field label={labels.category}>
                  <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                    {TECHNICAL_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {labels.categories[c]}
                      </option>
                    ))}
                  </Select>
                </Field>
                {category === "gas" && (
                  <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-semibold text-red-800">
                    {labels.gasWarning}
                  </p>
                )}
                <Field label={labels.urgency} hint={labels.urgencyHint}>
                  <Select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}>
                    {(["routine", "priority", "urgent"] as const).map((u) => (
                      <option key={u} value={u}>
                        {labels.urgencies[u]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            )}
            <Field label={labels.title} hint={labels.titleHint}>
              <Input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label={labels.description} hint={labels.descriptionHint}>
              <Textarea required={kind === "technical"} maxLength={4000} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <div>
              <p className="mb-2 text-sm font-medium text-ink">{labels.photos}</p>
              {/* The file field itself is kept for the keyboard and for assistive tech; what is seen is a button in the space's own style. */}
              <label className="tactile inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-sand-200 bg-white px-3.5 text-sm font-semibold text-brand-700 shadow-sm transition hover:border-brand-300 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600">
                <Icon name="camera" size={18} className="shrink-0" />
                {labels.photoPick}
                <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => pickFiles(e.target.files)} />
              </label>
              <p className="mt-2 text-xs text-ink-soft">{labels.photosHint}</p>
              {files.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5" aria-live="polite">
                  {files.map((f) => (
                    <li key={f.name + f.size} className="max-w-full truncate rounded-full bg-sand-100 px-2.5 py-1 text-xs font-medium text-ink">{f.name}</li>
                  ))}
                </ul>
              )}
            </div>

            {state === "failed" && (
              <p role="alert" className="text-xs font-semibold text-red-700">
                {labels.failed}
              </p>
            )}
            {state === "noLease" && (
              <p role="alert" className="text-xs font-semibold text-red-700">
                {labels.noLease}
              </p>
            )}
            {state === "sample" && sampleNote && (
              <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                {sampleNote}
              </p>
            )}

            <div className="flex flex-wrap justify-between gap-2">
              <Button type="button" variant="ghost" onClick={() => { setGuided(false); setKind(null); }} disabled={state === "sending" || state === "uploading"}>
                {labels.back}
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={close} disabled={state === "sending" || state === "uploading"}>
                  {labels.cancel}
                </Button>
                <Button type="submit" loading={state === "sending" || state === "uploading"}>
                  {state === "uploading" ? labels.uploading : state === "sending" ? labels.sending : labels.send}
                </Button>
              </div>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

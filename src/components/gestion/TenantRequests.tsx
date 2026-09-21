"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Modal, Select, Textarea } from "@/components/pro/ui";
import type { RequestLabels } from "@/lib/portal/labels";
import { REQUEST_KINDS, TECHNICAL_CATEGORIES, type RequestKind } from "@/lib/portal/types";

/**
 * A new request, in two steps: what it is about (a technical problem, a
 * document, a question, anything else), then the few details that let the
 * manager act. A technical problem lands as an intervention in its
 * category; photos travel with it. The request is written through the API
 * under the tenant's own session and the page then reads it back.
 */

const MAX_FILES = 5;
const MAX_BYTES = 8 * 1024 * 1024;

export default function TenantRequests({
  labels,
  canCreate,
  sampleNote,
  initialOpen = false,
}: {
  labels: RequestLabels;
  /** The tenant has a tenancy in force: a request has somewhere to land. */
  canCreate: boolean;
  /** On a sample cabinet, the form is shown but nothing is written. */
  sampleNote: string | null;
  initialOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen);
  const [kind, setKind] = useState<RequestKind | null>(null);
  const [category, setCategory] = useState<string>("heating");
  const [severity, setSeverity] = useState<"routine" | "priority" | "urgent">("routine");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [state, setState] = useState<"idle" | "sending" | "uploading" | "failed" | "noLease" | "sample">("idle");

  useEffect(() => {
    if (initialOpen) setOpen(true);
  }, [initialOpen]);

  const reset = () => {
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
    const chosen = Array.from(list ?? []).filter((f) => f.type.startsWith("image/") && f.size <= MAX_BYTES).slice(0, MAX_FILES);
    setFiles(chosen);
  };

  if (!canCreate) return null;

  return (
    <>
      <Button onClick={() => setOpen(true)}>{labels.open}</Button>
      <Modal open={open} onClose={close} title={kind ? labels.kinds[kind][0] : labels.open} closeLabel={labels.close}>
        {!kind ? (
          <div>
            <p className="mb-3 text-sm text-ink-soft">{labels.kind}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {REQUEST_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className="tactile rounded-2xl border border-sand-200 bg-white p-4 text-left shadow-sm transition hover:border-brand-200 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                >
                  <p className="font-display text-base font-bold text-ink">{labels.kinds[k][0]}</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-soft">{labels.kinds[k][1]}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={submit}>
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
                <Field label={labels.urgency}>
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
            <Field label={labels.photos} hint={labels.photosHint}>
              <Input type="file" accept="image/*" multiple className="py-2 text-xs" onChange={(e) => pickFiles(e.target.files)} />
              {files.length > 0 && <p className="mt-1 text-xs text-ink-soft">{files.map((f) => f.name).join(", ")}</p>}
            </Field>

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
              <Button type="button" variant="ghost" onClick={() => setKind(null)} disabled={state === "sending" || state === "uploading"}>
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

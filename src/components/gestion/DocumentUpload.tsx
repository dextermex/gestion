"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Modal, Select } from "@/components/pro/ui";
import { callForm } from "./call";

/**
 * A piece added to the register: the file, its class, a name, and the
 * property it hangs off when it does. The file goes into the workspace's
 * private folder and the row into the register under the caller's own
 * token; the page re-reads the register. A sample cabinet plays the
 * outcome and stores nothing.
 */
export interface DocumentLabels {
  add: string;
  file: string;
  fileHint: string;
  name: string;
  klass: string;
  related: string;
  relatedNone: string;
  save: string;
  saved: string;
  invalid: string;
  tooLarge: string;
  badType: string;
  failed: string;
  close: string;
}

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/avif,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const BACK = "/app/documents";

export default function DocumentUpload({
  classes,
  properties,
  writable,
  sampleNote,
  labels,
}: {
  classes: Array<{ value: string; label: string }>;
  properties: Array<{ id: string; label: string }>;
  writable: boolean;
  sampleNote: string | null;
  labels: DocumentLabels;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [klass, setKlass] = useState(classes[0]?.value ?? "other");
  const [propertyId, setPropertyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setName("");
    setPropertyId("");
    if (fileInput.current) fileInput.current.value = "";
  };

  const save = async () => {
    setError(null);
    if (!file) {
      setError(labels.invalid);
      return;
    }
    if (!writable) {
      setNote(labels.saved);
      setOpen(false);
      reset();
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("class", klass);
      form.set("name", name.trim() || file.name);
      if (propertyId) {
        form.set("relatedType", "property");
        form.set("relatedId", propertyId);
      }
      const res = await callForm("/api/documents", form, BACK);
      if (!res) return;
      if (res.ok) {
        setNote(labels.saved);
        setOpen(false);
        reset();
        router.refresh();
      } else setError(res.status === 415 ? labels.badType : res.status === 413 ? labels.tooLarge : res.status === 400 ? labels.invalid : labels.failed);
    } catch {
      setError(labels.failed);
    }
    setBusy(false);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        {note && (
          <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
            {note}
          </p>
        )}
        <Button onClick={() => setOpen(true)}>{labels.add}</Button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={labels.add} closeLabel={labels.close}>
        <div className="space-y-3">
          <Field label={labels.file} hint={labels.fileHint}>
            <input
              ref={fileInput}
              id="document-file"
              type="file"
              accept={ACCEPT}
              className="block w-full text-sm text-ink file:mr-3 file:rounded-lg file:border file:border-sand-200 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink-soft"
              onChange={(e) => {
                const chosen = e.target.files?.[0] ?? null;
                setFile(chosen);
                if (chosen && !name.trim()) setName(chosen.name);
              }}
              disabled={busy}
            />
          </Field>
          <Field label={labels.name}>
            <Input value={name} maxLength={160} onChange={(e) => setName(e.target.value)} disabled={busy} />
          </Field>
          <Field label={labels.klass}>
            <Select value={klass} onChange={(e) => setKlass(e.target.value)} disabled={busy}>
              {classes.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={labels.related}>
            <Select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} disabled={busy}>
              <option value="">{labels.relatedNone}</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-4 flex justify-end">
          <Button loading={busy} disabled={!file} onClick={save}>
            {labels.save}
          </Button>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-xs font-semibold text-red-700">
            {error}
          </p>
        )}
        {!writable && sampleNote && <p className="mt-3 text-[11px] text-amber-900/80">{sampleNote}</p>}
      </Modal>
    </>
  );
}

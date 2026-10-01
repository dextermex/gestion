"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Modal, Select, Spinner } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import { fmt, type Locale } from "@/lib/i18n/config";
import { euros, formatDate } from "@/lib/types";
import { sizeLabel } from "@/lib/documents/labels";
import { RECOGNISABLE_TYPES } from "@/lib/gestion/documents-rules";
import type { Recognition } from "@/lib/documents/recognition";
import { callForm } from "./call";

/**
 * A piece added to the register: the file first, then its name, its class
 * and the property it hangs off. When the deployment carries a reader, the
 * file is read as soon as it is dropped and the three fields fill
 * themselves with a proposal (class, clean title, related record) beside
 * the key facts it found; nothing the person already typed is overwritten,
 * and every field stays theirs to change. The file goes into the
 * workspace's private folder and the row into the register under the
 * caller's own token; the page re-reads the register. A sample cabinet
 * plays the outcome and stores nothing.
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
  dropTitle: string;
  dropChoose: string;
  remove: string;
  reading: string;
  recognised: string;
  confidenceHigh: string;
  confidenceMedium: string;
  confidenceLow: string;
  recogUnavailable: string;
  factsTitle: string;
  factSummary: string;
  factDate: string;
  factAmount: string;
  factParties: string;
  factReference: string;
}

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/avif,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const BACK = "/app/documents";

type Reading = "idle" | "reading" | "done" | "unavailable";

export default function DocumentUpload({
  classes,
  properties,
  writable,
  sampleNote,
  labels,
  recognition,
  locale,
}: {
  classes: Array<{ value: string; label: string }>;
  properties: Array<{ id: string; label: string }>;
  writable: boolean;
  sampleNote: string | null;
  labels: DocumentLabels;
  /** The deployment carries a reader: a dropped file is read before it is named. */
  recognition: boolean;
  locale: Locale;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const analysis = useRef<AbortController | null>(null);
  // What the person wrote themselves: a proposal never replaces it.
  const touched = useRef({ name: false, klass: false, related: false });
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [klass, setKlass] = useState(classes[0]?.value ?? "other");
  const [propertyId, setPropertyId] = useState("");
  const [reading, setReading] = useState<Reading>("idle");
  const [facts, setFacts] = useState<Recognition | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stopReading = () => {
    analysis.current?.abort();
    analysis.current = null;
  };

  const reset = () => {
    stopReading();
    setFile(null);
    setName("");
    setPropertyId("");
    setReading("idle");
    setFacts(null);
    touched.current = { name: false, klass: false, related: false };
    if (fileInput.current) fileInput.current.value = "";
  };

  const analyse = async (chosen: File) => {
    if (!recognition || !RECOGNISABLE_TYPES.has(chosen.type)) return;
    stopReading();
    const controller = new AbortController();
    analysis.current = controller;
    setReading("reading");
    try {
      const form = new FormData();
      form.set("file", chosen);
      form.set("lang", locale);
      form.set("candidates", JSON.stringify(properties));
      const res = await fetch("/api/documents/analyser", { method: "POST", body: form, signal: controller.signal });
      if (controller.signal.aborted) return;
      const body = (res.ok ? await res.json().catch(() => null) : null) as { configured?: boolean; supported?: boolean; recognition?: Recognition | null } | null;
      if (!body || body.configured === false || body.supported === false) {
        setReading("idle");
        return;
      }
      const found = body.recognition;
      if (!found) {
        setReading("unavailable");
        return;
      }
      if (!touched.current.name && found.title) setName(found.title);
      if (!touched.current.klass && classes.some((c) => c.value === found.klass)) setKlass(found.klass);
      if (!touched.current.related && found.relatedId && properties.some((p) => p.id === found.relatedId)) setPropertyId(found.relatedId);
      setFacts(found);
      setReading("done");
    } catch {
      if (!controller.signal.aborted) setReading("unavailable");
    } finally {
      if (analysis.current === controller) analysis.current = null;
    }
  };

  const pick = (chosen: File | null) => {
    setError(null);
    setFile(chosen);
    setFacts(null);
    setReading("idle");
    if (!chosen) {
      stopReading();
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    // The file's name stands in until the person, or the reader, names the piece.
    if (!touched.current.name || !name.trim()) setName(chosen.name);
    void analyse(chosen);
  };

  const save = async () => {
    setError(null);
    if (!file) {
      setError(labels.invalid);
      return;
    }
    stopReading();
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

  const classLabel = (value: string) => classes.find((c) => c.value === value)?.label ?? value;
  const confidenceLabel = facts ? (facts.confidence === "high" ? labels.confidenceHigh : facts.confidence === "medium" ? labels.confidenceMedium : labels.confidenceLow) : "";
  const hasFacts = facts !== null && (facts.summary !== "" || facts.documentDate !== null || facts.amountCents !== null || facts.parties.length > 0 || facts.reference !== null);

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
        <div className="crm-drop">
          {file ? (
            <div className="crm-drop-file">
              <span className="crm-doc-icon" aria-hidden>
                {reading === "reading" ? <Spinner size={18} className="text-brand-700" /> : <Icon name="documents" size={18} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="crm-drop-name">{file.name}</p>
                <p className="crm-drop-meta">{sizeLabel(Math.max(1, Math.round(file.size / 1024)), locale)}</p>
              </div>
              <button type="button" className="crm-drop-remove" onClick={() => pick(null)} aria-label={labels.remove} disabled={busy}>
                <Icon name="x" size={16} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={"crm-drop-zone" + (over ? " is-over" : "")}
              onClick={() => fileInput.current?.click()}
              onDragEnter={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                const dropped = e.dataTransfer.files?.[0] ?? null;
                if (dropped) pick(dropped);
              }}
              disabled={busy}
            >
              <span className="crm-symbol" aria-hidden>
                <Icon name="documents" size={22} />
              </span>
              <span className="crm-drop-title">{labels.dropTitle}</span>
              <span className="crm-drop-hint">{labels.fileHint}</span>
              <span className="crm-drop-button">{labels.dropChoose}</span>
            </button>
          )}
          <input
            ref={fileInput}
            id="document-file"
            type="file"
            accept={ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-label={labels.file}
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
            disabled={busy}
          />
        </div>

        {reading === "reading" && (
          <p role="status" className="crm-reading">
            <Icon name="ai" size={16} />
            <span>{labels.reading}</span>
          </p>
        )}
        {reading === "done" && facts && (
          <p role="status" className="crm-reading is-done">
            <Icon name="check" size={16} />
            <span>{fmt(labels.recognised, { klass: classLabel(facts.klass), confidence: confidenceLabel })}</span>
          </p>
        )}
        {reading === "unavailable" && (
          <p role="status" className="crm-reading">
            <Icon name="alert" size={16} />
            <span>{labels.recogUnavailable}</span>
          </p>
        )}

        <div className="crm-doc-fields">
          <Field label={labels.name}>
            <Input
              value={name}
              maxLength={160}
              onChange={(e) => {
                touched.current.name = true;
                setName(e.target.value);
              }}
              disabled={busy}
            />
          </Field>
          <Field label={labels.klass}>
            <Select
              value={klass}
              onChange={(e) => {
                touched.current.klass = true;
                setKlass(e.target.value);
              }}
              disabled={busy}
            >
              {classes.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={labels.related}>
            <Select
              value={propertyId}
              onChange={(e) => {
                touched.current.related = true;
                setPropertyId(e.target.value);
              }}
              disabled={busy}
            >
              <option value="">{labels.relatedNone}</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {hasFacts && facts && (
          <section className="crm-doc-facts" aria-label={labels.factsTitle}>
            <p className="crm-doc-facts-title">{labels.factsTitle}</p>
            <dl>
              {facts.summary && (
                <>
                  <dt>{labels.factSummary}</dt>
                  <dd>{facts.summary}</dd>
                </>
              )}
              {facts.documentDate && (
                <>
                  <dt>{labels.factDate}</dt>
                  <dd>{formatDate(facts.documentDate, locale)}</dd>
                </>
              )}
              {facts.amountCents !== null && (
                <>
                  <dt>{labels.factAmount}</dt>
                  <dd>{euros(facts.amountCents, locale)}</dd>
                </>
              )}
              {facts.parties.length > 0 && (
                <>
                  <dt>{labels.factParties}</dt>
                  <dd>{facts.parties.join(", ")}</dd>
                </>
              )}
              {facts.reference && (
                <>
                  <dt>{labels.factReference}</dt>
                  <dd>{facts.reference}</dd>
                </>
              )}
            </dl>
          </section>
        )}

        <div className="mt-6 flex justify-end">
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

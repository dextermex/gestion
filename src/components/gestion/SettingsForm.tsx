"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select } from "@/components/pro/ui";
import type { DemoLessor } from "@/lib/demo/data";
import { callJson } from "./call";

/**
 * The lessor's identity and the account tenants pay into, as the documents
 * print them. Saved as one row of the workspace; a sample cabinet shows
 * its values and saves nothing.
 */
export interface SettingsLabels {
  fieldLegalName: string;
  fieldSignatory: string;
  fieldStreet: string;
  fieldNumber: string;
  fieldPostalCode: string;
  fieldCity: string;
  fieldCountry: string;
  fieldEmail: string;
  fieldPhone: string;
  fieldIban: string;
  fieldBic: string;
  fieldHolder: string;
  fieldDocLang: string;
  notifyTenant: string;
  notifyManager: string;
  save: string;
  saved: string;
  invalidName: string;
  invalidIban: string;
  invalidBic: string;
  invalidEmail: string;
  failed: string;
}

const BACK = "/app/reglages";

export default function SettingsForm({
  initial,
  languages,
  writable,
  sampleNote,
  labels,
}: {
  initial: DemoLessor;
  /** The languages a template exists in: the only ones a document can be produced in. */
  languages: Array<{ value: string; label: string }>;
  writable: boolean;
  sampleNote: string | null;
  labels: SettingsLabels;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    legalName: initial.legalName,
    signatoryName: initial.signatoryName,
    addressStreet: initial.addressStreet,
    addressNumber: initial.addressNumber,
    postalCode: initial.postalCode,
    city: initial.city,
    country: initial.country || "LU",
    email: initial.email,
    phone: initial.phone,
    iban: initial.iban,
    bic: initial.bic,
    holderName: initial.holderName,
    documentLang: initial.documentLang,
    notifyTenantMessages: initial.notifyTenantMessages,
    notifyManagerMessages: initial.notifyManagerMessages,
  });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNote(null);
    if (!writable) {
      setNote(sampleNote ?? "");
      return;
    }
    setBusy(true);
    try {
      const res = await callJson("/api/reglages", "PATCH", form, BACK);
      if (!res) return;
      if (res.ok) {
        setNote(labels.saved);
        router.refresh();
      } else {
        const problem = String(res.payload.problem ?? "");
        setError(problem === "legalName" ? labels.invalidName : problem === "iban" ? labels.invalidIban : problem === "bic" ? labels.invalidBic : problem === "email" ? labels.invalidEmail : labels.failed);
      }
    } catch {
      setError(labels.failed);
    }
    setBusy(false);
  };

  return (
    <form onSubmit={save} className="space-y-3" id="settings-form">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={labels.fieldLegalName}>
          <Input value={form.legalName} maxLength={160} onChange={set("legalName")} disabled={busy} required />
        </Field>
        <Field label={labels.fieldSignatory}>
          <Input value={form.signatoryName} maxLength={160} onChange={set("signatoryName")} disabled={busy} />
        </Field>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
        <Field label={labels.fieldStreet}>
          <Input value={form.addressStreet} maxLength={160} onChange={set("addressStreet")} disabled={busy} />
        </Field>
        <Field label={labels.fieldNumber}>
          <Input value={form.addressNumber} maxLength={20} onChange={set("addressNumber")} disabled={busy} />
        </Field>
      </div>
      <div className="grid grid-cols-[8rem_minmax(0,1fr)_6rem] gap-3 max-sm:grid-cols-1">
        <Field label={labels.fieldPostalCode}>
          <Input value={form.postalCode} maxLength={12} onChange={set("postalCode")} disabled={busy} />
        </Field>
        <Field label={labels.fieldCity}>
          <Input value={form.city} maxLength={80} onChange={set("city")} disabled={busy} />
        </Field>
        <Field label={labels.fieldCountry}>
          <Input value={form.country} maxLength={2} onChange={set("country")} disabled={busy} />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={labels.fieldEmail}>
          <Input type="email" value={form.email} maxLength={160} onChange={set("email")} disabled={busy} />
        </Field>
        <Field label={labels.fieldPhone}>
          <Input value={form.phone} maxLength={40} onChange={set("phone")} disabled={busy} />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <Field label={labels.fieldIban}>
          <Input value={form.iban} maxLength={40} onChange={set("iban")} disabled={busy} className="tabular-nums" />
        </Field>
        <Field label={labels.fieldBic}>
          <Input value={form.bic} maxLength={11} onChange={set("bic")} disabled={busy} />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={labels.fieldHolder}>
          <Input value={form.holderName} maxLength={140} onChange={set("holderName")} disabled={busy} />
        </Field>
        <Field label={labels.fieldDocLang}>
          <Select value={form.documentLang} onChange={set("documentLang")} disabled={busy}>
            {languages.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="space-y-2 pt-1">
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={form.notifyTenantMessages}
            onChange={(e) => setForm((f) => ({ ...f, notifyTenantMessages: e.target.checked }))}
            disabled={busy}
            className="mt-0.5 h-4 w-4 rounded border-sand-300 text-brand-600 focus:ring-brand-400"
            data-settings-notify-tenant
          />
          <span className="text-sm text-ink">{labels.notifyTenant}</span>
        </label>
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={form.notifyManagerMessages}
            onChange={(e) => setForm((f) => ({ ...f, notifyManagerMessages: e.target.checked }))}
            disabled={busy}
            className="mt-0.5 h-4 w-4 rounded border-sand-300 text-brand-600 focus:ring-brand-400"
            data-settings-notify-manager
          />
          <span className="text-sm text-ink">{labels.notifyManager}</span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button type="submit" loading={busy}>
          {labels.save}
        </Button>
        {note && (
          <p role="status" className="text-xs font-semibold text-emerald-800">
            {note}
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs font-semibold text-red-700">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}

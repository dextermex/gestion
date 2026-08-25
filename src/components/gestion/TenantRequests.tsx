"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Field, Input, Modal, Select, Textarea } from "@/components/pro/ui";
import type { Dict } from "@/lib/i18n/fr";

/**
 * Tenant request flows: technical (breakdown, leak, heating…) and
 * administrative (attestation, contact change, lease question…). Demo build:
 * submitting shows the standard notice. The gas category surfaces the
 * emergency numbers before anything else.
 */

export type RequestKind = "technique" | "administrative";

export interface TenantTicketRow {
  id: string;
  ref: string;
  title: string;
  statusLabel: string;
  statusColor: string;
  dateLabel: string;
}

export default function TenantRequests({
  d,
  initial,
  tickets,
}: {
  d: Dict;
  initial?: RequestKind;
  tickets: TenantTicketRow[];
}) {
  const [open, setOpen] = useState<RequestKind | null>(initial ?? null);

  useEffect(() => {
    if (initial) setOpen(initial);
  }, [initial]);

  return (
    <div>
      <div className="stagger-rise grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          onClick={() => setOpen("technique")}
          className="tactile rounded-2xl border border-sand-200 bg-white p-5 text-left shadow-sm transition hover:border-brand-200 hover:shadow-md"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="m14.7 6.3 3 3L8 19H5v-3l9.7-9.7ZM13 21h8M16 5l3 3" />
            </svg>
          </span>
          <p className="mt-3 font-display text-base font-bold text-ink">{d.tenant.quickTech}</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">{d.tenant.quickTechSub}</p>
        </button>
        <button
          onClick={() => setOpen("administrative")}
          className="tactile rounded-2xl border border-sand-200 bg-white p-5 text-left shadow-sm transition hover:border-brand-200 hover:shadow-md"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v5h5M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM9 13h6M9 17h4" />
            </svg>
          </span>
          <p className="mt-3 font-display text-base font-bold text-ink">{d.tenant.quickAdmin}</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">{d.tenant.quickAdminSub}</p>
        </button>
      </div>

      <div className="mt-6">
        <h2 className="mb-3 font-display text-lg font-bold text-ink">{d.tenant.reqListTitle}</h2>
        <div className="overflow-hidden rounded-2xl border border-sand-200 bg-white shadow-sm">
          <ul className="divide-y divide-sand-100">
            {tickets.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{t.title}</p>
                  <p className="text-xs text-ink-soft">
                    {t.ref} · {t.dateLabel}
                  </p>
                </div>
                <Badge className={t.statusColor}>{t.statusLabel}</Badge>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <RequestModal d={d} kind={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function RequestModal({
  d,
  kind,
  onClose,
}: {
  d: Dict;
  kind: RequestKind | null;
  onClose: () => void;
}) {
  const [category, setCategory] = useState("heating");
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    setSubmitted(false);
    setCategory("heating");
  }, [kind]);

  const techCategories = [
    { id: "heating", label: d.tenant.catHeating },
    { id: "plumbing", label: d.tenant.catPlumbing },
    { id: "electric", label: d.tenant.catElectric },
    { id: "damp", label: d.tenant.catDamp },
    { id: "lock", label: d.tenant.catLock },
    { id: "gas", label: d.tenant.catGas },
    { id: "other", label: d.tenant.catOther },
  ];
  const admTypes = [
    { id: "attestation", label: d.tenant.admAttestation },
    { id: "contact", label: d.tenant.admContact },
    { id: "question", label: d.tenant.admQuestion },
    { id: "depart", label: d.tenant.admDepart },
    { id: "other", label: d.tenant.admOther },
  ];

  return (
    <Modal
      open={kind !== null}
      onClose={onClose}
      title={kind === "administrative" ? d.tenant.quickAdmin : d.tenant.quickTech}
      closeLabel={d.common.close}
    >
      {kind && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
          }}
        >
          {kind === "technique" ? (
            <>
              <Field label={d.tenant.formCategory}>
                <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                  {techCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {category === "gas" && (
                <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-semibold text-red-800">
                  {d.tenant.gasWarning}
                </p>
              )}
              <Field label={d.tenant.formUrgency}>
                <Select defaultValue="routine">
                  <option value="routine">{d.tenant.urgRoutine}</option>
                  <option value="priority">{d.tenant.urgPriority}</option>
                  <option value="urgent">{d.tenant.urgUrgent}</option>
                </Select>
              </Field>
              <Field label={d.tenant.formDesc} hint={d.tenant.formDescHint}>
                <Textarea required maxLength={2000} />
              </Field>
              <Field label={d.tenant.formPhoto}>
                <Input type="file" accept="image/*" multiple className="py-2 text-xs" />
              </Field>
              <label className="flex items-start gap-2.5 text-sm text-ink">
                <input type="checkbox" className="mt-1" />
                {d.tenant.formAccess}
              </label>
            </>
          ) : (
            <>
              <Field label={d.tenant.admType}>
                <Select defaultValue="attestation">
                  {admTypes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={d.tenant.formMessage}>
                <Textarea required maxLength={2000} />
              </Field>
            </>
          )}

          {submitted && (
            <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
              {d.tenant.reqSent}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {d.common.cancel}
            </Button>
            <Button type="submit">{d.tenant.formSend}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

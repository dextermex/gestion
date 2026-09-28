"use client";

import { useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Badge, Button, Field, Input, Modal, PageHeader, Select, Textarea } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import { getAcquisitionDict, type AcquisitionDict } from "@/lib/i18n/investment-acquisitions";
import { getInvestmentCopy } from "@/lib/i18n/investment";
import type { Locale } from "@/lib/i18n/config";
import { euros, formatDate } from "@/lib/types";
import {
  acquisitionActualDateFields, acquisitionDateFields, acquisitionSchema, acquisitionStages, emptyAcquisition, financingStatuses,
  parseAcquisitionEuro, sortAcquisitions, type AcquisitionDateField, type AcquisitionDraft,
  type AcquisitionRecord, type AcquisitionStage,
} from "@/lib/investment/acquisition";

const NOTARY_DIRECTORY = "https://www.notariat.lu/trouver-notaire";
const COMPROMIS_GUIDE = "https://guichet.public.lu/fr/citoyens/logement/acquisition/aspects-contractuels/compromis-vente.html";

const stageColors: Record<AcquisitionStage, string> = {
  research: "bg-slate-100 text-slate-800", viewing: "bg-sky-100 text-sky-800", offer: "bg-blue-100 text-blue-800",
  compromis: "bg-amber-100 text-amber-800", deed_pending: "bg-amber-100 text-amber-800",
  deed_signed: "bg-emerald-100 text-emerald-800", handover: "bg-emerald-100 text-emerald-800",
  paused: "bg-slate-100 text-slate-800", archived: "bg-slate-100 text-slate-800",
};

function isActive(record: AcquisitionRecord) {
  return !["handover", "paused", "archived"].includes(record.stage);
}

function StageBadge({ stage, d }: { stage: AcquisitionStage; d: AcquisitionDict }) {
  return <Badge className={stageColors[stage]}>{d.stages[stage]}</Badge>;
}

function OutboundLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 font-semibold text-brand-700 underline decoration-brand-200 underline-offset-4 hover:decoration-brand-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600">
    {children}<Icon name="external" size={16} aria-hidden />
  </a>;
}

export default function Acquisitions({ locale, records, onSave, readOnly = false }: {
  locale: Locale;
  records: AcquisitionRecord[];
  onSave: (record: AcquisitionDraft, id?: string) => Promise<void>;
  readOnly?: boolean;
}) {
  const d = getAcquisitionDict(locale);
  const investmentCopy = getInvestmentCopy(locale);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<AcquisitionStage | "active" | "all">("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ record: AcquisitionRecord | null } | null>(null);
  const [notice, setNotice] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const selected = records.find((record) => record.id === selectedId);
  const visible = useMemo(() => sortAcquisitions(records.filter((record) => {
    const matchesStage = stage === "all" || (stage === "active" ? isActive(record) : record.stage === stage);
    return matchesStage && `${record.name} ${record.address}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  })), [records, query, stage]);
  const activeRecords = records.filter(isActive);
  const nextNotary = activeRecords.filter((record) => record.notaryAppointmentDate && record.notaryAppointmentDate >= today && !record.deedSignedDate)
    .sort((a, b) => a.notaryAppointmentDate!.localeCompare(b.notaryAppointmentDate!))[0];

  function openEditor(record: AcquisitionRecord | null) {
    setNotice("");
    setSelectedId(null);
    setEditor({ record });
  }

  return <div className="investment-workspace">
    <PageHeader title={investmentCopy.acquisitions} subtitle={d.intro} actions={<>
      <Link className="ui-button investment-link-button" href="/app/financement/simulateur">{investmentCopy.simulator}</Link>
      {!readOnly && <Button onClick={() => openEditor(null)}><Icon name="plus" size={18} aria-hidden />{d.add}</Button>}
    </>} />
    {readOnly && <p className="rounded-2xl bg-slate-100 p-4 text-sm text-ink-soft">{d.readOnly}</p>}
    {notice && <p role="status" className="rounded-2xl bg-emerald-50 p-4 text-emerald-800">{notice}</p>}

    {records.length > 0 && <div className="investment-summary grid gap-6 sm:grid-cols-2">
      <dl className="investment-stat"><dt>{d.activeCount}</dt><dd>{activeRecords.length}</dd></dl>
      {nextNotary && <div className="min-w-0">
        <p className="text-sm text-ink-soft">{d.nextNotary}</p>
        <button type="button" onClick={() => setSelectedId(nextNotary.id)} className="mt-2 block min-h-11 text-left text-xl font-semibold text-ink underline decoration-transparent underline-offset-4 hover:decoration-brand-600 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600">
          <time dateTime={nextNotary.notaryAppointmentDate!}>{formatDate(nextNotary.notaryAppointmentDate, locale)}</time>
        </button>
        <p className="mt-1 break-words text-sm text-ink-soft">{nextNotary.name}{nextNotary.notaryName && ` · ${nextNotary.notaryName}`}</p>
      </div>}
    </div>}

    {records.length === 0 ? <section className="investment-panel investment-empty">
      <span className="crm-symbol mb-2"><Icon name="properties" size={24} aria-hidden /></span>
      <h2 className="text-2xl font-semibold tracking-tight text-ink">{d.emptyTitle}</h2>
      <p className="mt-3 max-w-xl text-base leading-relaxed text-ink-soft">{d.emptyBody}</p>
      {!readOnly && <Button className="mt-6" onClick={() => openEditor(null)}><Icon name="plus" size={18} aria-hidden />{d.add}</Button>}
    </section> : <section className="investment-panel">
      <div className="investment-toolbar">
        <div className="min-w-0 flex-1"><Field label={d.search}><Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></Field></div>
        <div className="min-w-0 sm:w-64"><Field label={d.filter}><Select value={stage} onChange={(event) => setStage(event.target.value as typeof stage)}>
          <option value="active">{d.active}</option><option value="all">{d.all}</option>
          {acquisitionStages.map((value) => <option key={value} value={value}>{d.stages[value]}</option>)}
        </Select></Field></div>
      </div>
      <p className="mb-3 mt-4 text-sm text-ink-soft">{d.sorted}</p>
      {visible.length === 0 ? <div className="py-12 text-center"><p className="text-ink-soft">{d.noResults}</p><Button variant="ghost" className="mt-4" onClick={() => { setQuery(""); setStage("all"); }}>{d.reset}</Button></div> : <ul className="investment-rows" aria-label={d.title}>
        {visible.map((record) => {
          const overdue = Boolean(record.nextActionDate && record.nextActionDate < today && isActive(record));
          return <li key={record.id}>
            <button type="button" onClick={() => setSelectedId(record.id)} className="investment-row w-full cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600" aria-label={`${d.details}: ${record.name}`}>
              <span className="investment-row-main min-w-0">
                <span className="crm-symbol shrink-0"><Icon name="properties" size={22} aria-hidden /></span>
                <span className="min-w-0 space-y-2">
                  <span className="flex items-start gap-3"><span className="min-w-0 break-words text-lg font-semibold text-ink">{record.name}</span><Icon name="chevron-right" className="mt-1 shrink-0 text-ink-soft" size={18} aria-hidden /></span>
                  <span className="block break-words text-sm text-ink-soft">{record.address}</span>
                  <StageBadge stage={record.stage} d={d} />
                </span>
              </span>
              <span className="investment-row-values min-w-0">
                <span className="min-w-0">
                  <span className="block text-sm text-ink-soft">{d.price}</span>
                  <span className="mt-1 block break-words text-base font-semibold tabular-nums text-ink">{record.askingPriceCents === null ? d.notSet : euros(record.askingPriceCents, locale)}</span>
                </span>
                <span className="min-w-0">
                  <span className="block text-sm text-ink-soft">{d.nextAction}</span>
                  <span className="mt-1 block break-words font-semibold text-ink">{record.nextAction || d.notSet}</span>
                  <span className={`mt-1 block text-sm ${overdue ? "font-semibold text-amber-800" : "text-ink-soft"}`}>
                    {record.nextActionDate ? <time dateTime={record.nextActionDate}>{formatDate(record.nextActionDate, locale)}</time> : d.undated}
                    {overdue && ` · ${d.overdue}`}
                  </span>
                  {record.notaryAppointmentDate && <span className="mt-2 block text-sm text-ink-soft">{d.notaryShort} · <time dateTime={record.notaryAppointmentDate}>{formatDate(record.notaryAppointmentDate, locale)}</time></span>}
                </span>
              </span>
            </button>
          </li>;
        })}
      </ul>}
    </section>}

    <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">{d.legalNote} <a href={COMPROMIS_GUIDE} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-brand-700">{d.source}</a></p>

    <Modal open={Boolean(selected && !editor)} onClose={() => setSelectedId(null)} title={selected?.name || d.details} closeLabel={d.close} wide>
      {selected && <div className="investment-workspace">
        <div className="flex flex-wrap items-center justify-between gap-4"><StageBadge stage={selected.stage} d={d} />{!readOnly && <Button variant="secondary" onClick={() => openEditor(selected)}><Icon name="edit" size={18} aria-hidden />{d.edit}</Button>}</div>
        <AcquisitionDetails record={selected} d={d} locale={locale} />
      </div>}
    </Modal>
    {editor && <AcquisitionEditor record={editor.record} d={d} locale={locale} onClose={() => setEditor(null)} onSave={async (draft, id) => {
      await onSave(draft, id);
      setEditor(null);
      setNotice(d.saved);
    }} />}
  </div>;
}

function AcquisitionDetails({ record, d, locale, compact = false }: { record: AcquisitionDraft; d: AcquisitionDict; locale: Locale; compact?: boolean }) {
  const dates = acquisitionDateFields.filter((key) => key !== "nextActionDate" && record[key]).sort((a, b) => record[a]!.localeCompare(record[b]!));
  return <div className="investment-detail space-y-8">
    <p className="break-words text-base text-ink-soft">{record.address}</p>
    {(!compact || record.nextAction || record.nextActionDate) && <section className="rounded-2xl bg-slate-50 p-5">
      <h3 className="text-sm font-medium text-ink-soft">{d.nextAction}</h3>
      <p className="mt-2 break-words text-xl font-semibold text-ink">{record.nextAction || d.nextActionUnplanned}</p>
      {(record.nextActionDate || record.nextAction) && <p className="mt-2 text-base text-ink-soft">{record.nextActionDate ? <time dateTime={record.nextActionDate}>{formatDate(record.nextActionDate, locale)}</time> : d.undated}</p>}
    </section>}
    {(record.askingPriceCents !== null || record.expectedRentCents !== null) && <section><h3 className="mb-4 text-lg font-semibold text-ink">{d.forecast}</h3><dl className="grid gap-6 sm:grid-cols-2">
      {record.askingPriceCents !== null && <div><dt className="text-sm text-ink-soft">{d.price}</dt><dd className="mt-2 text-xl font-semibold tabular-nums text-ink">{euros(record.askingPriceCents, locale)}</dd></div>}
      {record.expectedRentCents !== null && <div><dt className="text-sm text-ink-soft">{d.expectedRent}</dt><dd className="mt-2 text-xl font-semibold tabular-nums text-ink">{euros(record.expectedRentCents, locale)}</dd></div>}
    </dl>{record.expectedRentCents !== null && <p className="mt-4 text-sm text-ink-soft">{d.expectedHint}</p>}</section>}
    {(record.bankName || record.notaryName || record.financingStatus !== "research") && <section><h3 className="mb-4 text-lg font-semibold text-ink">{d.participants}</h3><dl className="grid gap-6 sm:grid-cols-2">
      {(record.bankName || record.financingStatus !== "research") && <div><dt className="text-sm text-ink-soft">{record.bankName ? d.bank : d.financing}</dt>{record.bankName && <dd className="mt-2 break-words font-semibold text-ink">{record.bankName}</dd>}<dd className="mt-2 text-sm text-ink-soft">{d.financingStatuses[record.financingStatus]}</dd></div>}
      {record.notaryName && <div><dt className="text-sm text-ink-soft">{d.notary}</dt><dd className="mt-2 break-words font-semibold text-ink">{record.notaryName}</dd></div>}
    </dl></section>}
    {dates.length > 0 && <section><h3 className="mb-4 text-lg font-semibold text-ink">{d.recordedDates}</h3>
      <ol className="divide-y divide-slate-200">{dates.map((key) => <li key={key} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 py-4">
        <span className="min-w-0 text-ink-soft">{d.dates[key]}</span><time className="font-semibold text-ink" dateTime={record[key]!}>{formatDate(record[key], locale)}</time>
      </li>)}</ol>
    </section>}
    {record.notes && <section><h3 className="mb-3 text-lg font-semibold text-ink">{d.notes}</h3><p className="whitespace-pre-wrap break-words leading-relaxed text-ink-soft">{record.notes}</p></section>}
    {!compact && <footer className="border-t border-slate-200 pt-4 text-sm"><OutboundLink href={NOTARY_DIRECTORY}>{d.notaryDirectory}</OutboundLink></footer>}
  </div>;
}

type DraftField = keyof AcquisitionDraft;
type FieldErrors = Partial<Record<DraftField, string>>;
const stepKeys = ["essentials", "optional", "review"] as const;

function requiredStageDates(stage: AcquisitionStage): AcquisitionDateField[] {
  if (stage === "compromis") return ["compromisDate"];
  if (stage === "deed_signed") return ["deedSignedDate"];
  if (stage === "handover") return ["handoverDate"];
  return [];
}

function FieldError({ id, error }: { id: string; error?: string }) {
  return error ? <p id={id} className="mt-2 text-sm font-medium text-red-700">{error}</p> : null;
}

function DateField({ name, value, required = false, hint, error, id, d, onChange }: {
  name: AcquisitionDateField; value: string | null; required?: boolean; hint?: string; error?: string;
  id: string; d: AcquisitionDict; onChange: (value: string | null) => void;
}) {
  return <div className="min-w-0"><Field label={d.dates[name]} hint={hint}>
    <Input id={id} type="date" value={value || ""} min="1000-01-01" max={(acquisitionActualDateFields as readonly string[]).includes(name) ? new Date().toISOString().slice(0, 10) : "9999-12-31"} required={required} aria-invalid={Boolean(error)} {...(error ? { "aria-describedby": `${id}-error` } : {})} onChange={(event) => onChange(event.target.value || null)} />
  </Field><FieldError id={`${id}-error`} error={error} /></div>;
}

function AcquisitionEditor({ record, d, locale, onClose, onSave }: {
  record: AcquisitionRecord | null; d: AcquisitionDict; locale: Locale;
  onClose: () => void; onSave: (draft: AcquisitionDraft, id?: string) => Promise<void>;
}) {
  const initial = useMemo(() => {
    if (!record) return emptyAcquisition();
    // Keep record metadata out of the strict draft schema.
    const fields = Object.keys(emptyAcquisition()) as DraftField[];
    return Object.fromEntries(fields.map((field) => [field, record[field]])) as AcquisitionDraft;
  }, [record]);
  const [draft, setDraft] = useState<AcquisitionDraft>(initial);
  const [price, setPrice] = useState(initial.askingPriceCents === null ? "" : (initial.askingPriceCents / 100).toFixed(2));
  const [rent, setRent] = useState(initial.expectedRentCents === null ? "" : (initial.expectedRentCents / 100).toFixed(2));
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [expanded, setExpanded] = useState({ budget: false, calendar: false, notes: false });
  const errorRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const idPrefix = useId();
  const stageDates = requiredStageDates(draft.stage);
  const fieldId = (field: DraftField) => `${idPrefix}-${field}`;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
    || price !== (initial.askingPriceCents === null ? "" : (initial.askingPriceCents / 100).toFixed(2))
    || rent !== (initial.expectedRentCents === null ? "" : (initial.expectedRentCents / 100).toFixed(2));

  function change<K extends DraftField>(field: K, value: AcquisitionDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSaveError("");
  }

  function close() {
    if (saving) return;
    if (dirty) setDiscard(true);
    else onClose();
  }

  function goToStep(nextStep: number) {
    setStep(nextStep);
    setErrors({});
    setSaveError("");
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  function validate(essentialsOnly: boolean): AcquisitionDraft | null {
    const nextErrors: FieldErrors = {};
    const candidate = { ...draft };
    if (!essentialsOnly) {
      try { candidate.askingPriceCents = parseAcquisitionEuro(price); } catch { nextErrors.askingPriceCents = d.moneyError; }
      try { candidate.expectedRentCents = parseAcquisitionEuro(rent); } catch { nextErrors.expectedRentCents = d.moneyError; }
    }
    const parsed = acquisitionSchema.safeParse(candidate);
    if (!parsed.success) for (const issue of parsed.error.issues) {
      const field = issue.path[0] as DraftField;
      if (essentialsOnly && !["name", "address", "stage", ...stageDates].includes(field)) continue;
      nextErrors[field] = issue.message === "signed_date_required" ? d.signedError
        : issue.message === "future_actual_date" ? d.futureDateError
        : issue.message === "invalid_date" ? d.dateError
          : issue.code === "too_big" ? d.lengthError : d.requiredError;
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      setExpanded((current) => ({ ...current,
        budget: current.budget || Boolean(nextErrors.askingPriceCents || nextErrors.expectedRentCents || nextErrors.bankName),
        calendar: current.calendar || acquisitionDateFields.some((field) => nextErrors[field]) || Boolean(nextErrors.notaryName),
        notes: current.notes || Boolean(nextErrors.notes),
      }));
      requestAnimationFrame(() => errorRef.current?.focus());
      return null;
    }
    return parsed.success ? parsed.data : candidate;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const valid = validate(step === 0);
    if (!valid) return;
    setDraft(valid);
    if (step < 2) { goToStep(step + 1); return; }
    setSaving(true);
    setSaveError("");
    try { await onSave(valid, record?.id); }
    catch { setSaving(false); setSaveError(d.saveError); requestAnimationFrame(() => errorRef.current?.focus()); }
  }

  const labelForField = (field: DraftField): string => {
    if (acquisitionDateFields.includes(field as AcquisitionDateField)) return d.dates[field as AcquisitionDateField];
    const labels: Partial<Record<DraftField, string>> = { name: d.name, address: d.address, stage: d.stage, askingPriceCents: d.askingPrice, expectedRentCents: d.expectedRent, bankName: d.bank, financingStatus: d.financing, notaryName: d.notary, nextAction: d.nextAction, notes: d.notes };
    return labels[field] || d.project;
  };

  return <Modal open onClose={close} title={discard ? d.discardTitle : record ? d.edit : d.add} closeLabel={d.close} wide>
    <div className="investment-workspace">
      {discard ? <div><p className="text-base leading-relaxed text-ink-soft">{d.discardBody}</p><div className="mt-6 flex flex-wrap gap-3"><Button onClick={() => setDiscard(false)}>{d.keepEditing}</Button><Button variant="secondary" onClick={onClose}>{d.discard}</Button></div></div> : <form className="investment-form" onSubmit={submit} noValidate>
        <ol className="investment-steps" aria-label={d.stepsLabel}>{stepKeys.map((key, index) => <li key={key} className="investment-step" aria-current={step === index ? "step" : undefined}>
          <span aria-hidden className="tabular-nums">{index < step ? <Icon name="check" size={16} /> : index + 1}</span><span>{d.steps[key]}</span>
        </li>)}</ol>
        <div><h3 ref={headingRef} tabIndex={-1} className="text-xl font-semibold tracking-tight text-ink outline-none">{d.steps[stepKeys[step]]}</h3><p className="mt-2 text-base leading-relaxed text-ink-soft">{step === 0 ? d.essentialHint : step === 1 ? d.optionalHint : d.reviewHint}</p></div>

        {(Object.values(errors).some(Boolean) || saveError) && <div ref={errorRef} tabIndex={-1} role="alert" className="rounded-2xl bg-red-50 p-4 text-red-800 outline-none">
          <p className="font-semibold">{saveError || d.errorTitle}</p>
          {!saveError && <ul className="mt-2 space-y-2">{Object.entries(errors).filter(([, error]) => error).map(([field, error]) => <li key={field}><button type="button" className="min-h-11 text-left underline underline-offset-4" onClick={() => document.getElementById(fieldId(field as DraftField))?.focus()}>{labelForField(field as DraftField)}: {error}</button></li>)}</ul>}
        </div>}

        {step === 0 && <div className="space-y-5">
          <div><Field label={d.name} hint={d.required}><Input id={fieldId("name")} autoComplete="off" required maxLength={200} value={draft.name} aria-invalid={Boolean(errors.name)} {...(errors.name ? { "aria-describedby": `${fieldId("name")}-error` } : {})} onChange={(event) => change("name", event.target.value)} /></Field><FieldError id={`${fieldId("name")}-error`} error={errors.name} /></div>
          <div><Field label={d.address} hint={d.required}><Input id={fieldId("address")} autoComplete="off" required maxLength={500} value={draft.address} aria-invalid={Boolean(errors.address)} {...(errors.address ? { "aria-describedby": `${fieldId("address")}-error` } : {})} onChange={(event) => change("address", event.target.value)} /></Field><FieldError id={`${fieldId("address")}-error`} error={errors.address} /></div>
          <Field label={d.stage}><Select id={fieldId("stage")} value={draft.stage} onChange={(event) => change("stage", event.target.value as AcquisitionStage)}>{acquisitionStages.map((value) => <option key={value} value={value}>{d.stages[value]}</option>)}</Select></Field>
          {stageDates.map((key) => <DateField key={key} name={key} value={draft[key]} required hint={d.signedHint} error={errors[key]} id={fieldId(key)} d={d} onChange={(value) => change(key, value)} />)}
          {stageDates.length > 0 && <p className="text-sm leading-relaxed text-ink-soft">{d.legalNote}</p>}
        </div>}

        {step === 1 && <div className="space-y-6">
          <div className="investment-fields">
            <div><Field label={d.nextAction} hint={d.optional}><Input id={fieldId("nextAction")} value={draft.nextAction} maxLength={500} onChange={(event) => change("nextAction", event.target.value)} /></Field><FieldError id={`${fieldId("nextAction")}-error`} error={errors.nextAction} /></div>
            <DateField name="nextActionDate" value={draft.nextActionDate} hint={d.optional} error={errors.nextActionDate} id={fieldId("nextActionDate")} d={d} onChange={(value) => change("nextActionDate", value)} />
          </div>
          <details open={expanded.budget} onToggle={(event) => { const open = event.currentTarget.open; setExpanded((current) => ({ ...current, budget: open })); }} className="rounded-2xl border border-slate-200 p-4 sm:p-5">
            <summary className="cursor-pointer font-semibold text-ink">{d.budget}</summary>
            <div className="investment-fields mt-5">
              <div><Field label={d.askingPrice} hint={d.moneyHint}><Input id={fieldId("askingPriceCents")} inputMode="decimal" value={price} maxLength={32} aria-invalid={Boolean(errors.askingPriceCents)} {...(errors.askingPriceCents ? { "aria-describedby": `${fieldId("askingPriceCents")}-error` } : {})} onChange={(event) => { setPrice(event.target.value); setErrors((current) => ({ ...current, askingPriceCents: undefined })); }} /></Field><FieldError id={`${fieldId("askingPriceCents")}-error`} error={errors.askingPriceCents} /></div>
              <div><Field label={d.expectedRent} hint={d.expectedHint}><Input id={fieldId("expectedRentCents")} inputMode="decimal" value={rent} maxLength={32} aria-invalid={Boolean(errors.expectedRentCents)} {...(errors.expectedRentCents ? { "aria-describedby": `${fieldId("expectedRentCents")}-error` } : {})} onChange={(event) => { setRent(event.target.value); setErrors((current) => ({ ...current, expectedRentCents: undefined })); }} /></Field><FieldError id={`${fieldId("expectedRentCents")}-error`} error={errors.expectedRentCents} /></div>
              <div><Field label={d.bank}><Input id={fieldId("bankName")} value={draft.bankName} maxLength={200} onChange={(event) => change("bankName", event.target.value)} /></Field><FieldError id={`${fieldId("bankName")}-error`} error={errors.bankName} /></div>
              <Field label={d.financing}><Select id={fieldId("financingStatus")} value={draft.financingStatus} onChange={(event) => change("financingStatus", event.target.value as AcquisitionDraft["financingStatus"])}>{financingStatuses.map((value) => <option key={value} value={value}>{d.financingStatuses[value]}</option>)}</Select></Field>
            </div>
          </details>
          <details open={expanded.calendar} onToggle={(event) => { const open = event.currentTarget.open; setExpanded((current) => ({ ...current, calendar: open })); }} className="rounded-2xl border border-slate-200 p-4 sm:p-5">
            <summary className="cursor-pointer font-semibold text-ink">{d.calendar}</summary>
            <div className="mt-5 space-y-5">
              <div><Field label={d.notary} hint={d.notaryHint}><Input id={fieldId("notaryName")} value={draft.notaryName} maxLength={200} onChange={(event) => change("notaryName", event.target.value)} /></Field><FieldError id={`${fieldId("notaryName")}-error`} error={errors.notaryName} /></div>
              <div className="text-sm"><OutboundLink href={NOTARY_DIRECTORY}>{d.notaryDirectory}</OutboundLink></div>
              <div className="investment-fields">{acquisitionDateFields.filter((key) => key !== "nextActionDate" && !stageDates.includes(key)).map((key) => <DateField key={key} name={key} value={draft[key]} hint={key === "financeDeadline" ? d.deadlineHint : undefined} error={errors[key]} id={fieldId(key)} d={d} onChange={(value) => change(key, value)} />)}</div>
            </div>
          </details>
          <details open={expanded.notes} onToggle={(event) => { const open = event.currentTarget.open; setExpanded((current) => ({ ...current, notes: open })); }} className="rounded-2xl border border-slate-200 p-4 sm:p-5">
            <summary className="cursor-pointer font-semibold text-ink">{d.notes}</summary><div className="mt-5"><Field label={d.notes} hint={d.notesHint}><Textarea id={fieldId("notes")} rows={4} maxLength={10000} value={draft.notes} onChange={(event) => change("notes", event.target.value)} /></Field><FieldError id={`${fieldId("notes")}-error`} error={errors.notes} /></div>
          </details>
        </div>}

        {step === 2 && <div className="investment-review"><div className="mb-6 space-y-3"><h4 className="break-words text-xl font-semibold text-ink">{draft.name}</h4><StageBadge stage={draft.stage} d={d} /></div><AcquisitionDetails record={draft} d={d} locale={locale} compact /></div>}
        <footer>
          <Button type="button" variant="ghost" disabled={saving} onClick={() => step === 0 ? close() : goToStep(step - 1)}>{step === 0 ? d.cancel : d.back}</Button>
          <Button type="submit" loading={saving}>{step === 2 ? d.save : d.next}{step < 2 && <Icon name="chevron-right" size={18} aria-hidden />}</Button>
        </footer>
      </form>}
    </div>
  </Modal>;
}

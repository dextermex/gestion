"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Badge, Button, Field, Input, InlineError, Modal, PageHeader, Select, Textarea } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import GlassHouse from "../GlassHouse";
import { amortize, investmentCashflow, repaidProgress } from "@/domain/investment";
import { loanSchema, LUXEMBOURG_LENDERS, moneyInput, type FinanceProperty, type LoanDraft, type LoanRecord } from "@/lib/investment/loans";
import { getAcquisitionDict } from "@/lib/i18n/investment-acquisitions";
import { getInvestmentCopy } from "@/lib/i18n/investment";
import type { InvestmentCopy } from "@/lib/i18n/investment/fr";
import type { Locale } from "@/lib/i18n/config";
import { euros, formatDate, formatPct } from "@/lib/types";

type Props = { locale: Locale; records: LoanRecord[]; properties: FinanceProperty[]; readOnly?: boolean; onSave: (draft: LoanDraft, id?: string) => Promise<void> };
const paymentOf = (r: LoanRecord) => amortize({ balanceCents: r.balanceCents, annualRatePct: r.annualRatePct, remainingMonths: r.remainingMonths }).monthlyPaymentCents;

export default function Loans({ locale, records, properties, readOnly, onSave }: Props) {
  const t = getInvestmentCopy(locale);
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<LoanRecord | "new" | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const monthly = records.reduce((sum, loan) => sum + paymentOf(loan), 0);
  const outstanding = records.reduce((sum, loan) => sum + loan.balanceCents, 0);
  const filtered = records.filter((loan) => filter === "all" || (filter === "active" ? loan.balanceCents > 0 : loan.balanceCents === 0))
    .sort((a, b) => (a.nextPaymentDate || "9999").localeCompare(b.nextPaymentDate || "9999") || a.name.localeCompare(b.name));
  const detail = records.find((loan) => loan.id === selected);
  const unknown = properties.filter((p) => !records.some((r) => r.propertyId === p.id));
  return <div className="investment-workspace">
    <PageHeader title={t.loans} subtitle={t.loansHint} actions={<>
      <Link className="ui-button investment-link-button" href="/app/financement/simulateur">{t.simulator}</Link>
      {!readOnly && properties.length > 0 && <Button onClick={() => setEditing("new")}><Icon name="plus" size={18}/>{t.addLoan}</Button>}
    </>}/>
    {saved && <p role="status" className="text-brand-800">{t.saved}</p>}
    {readOnly && <p className="text-ink-soft">{t.readOnly}</p>}
    {records.length > 0 ? <>
      <section className="investment-summary" aria-label={t.loans}>
        <dl className="investment-stat investment-stat-primary"><dt>{t.monthly}</dt><dd>{euros(monthly, locale)}</dd><p>{t.monthlyHint}</p></dl>
        <dl className="investment-stat"><dt>{t.outstanding}</dt><dd>{euros(outstanding, locale)}</dd><p>{t.outstandingHint}</p></dl>
      </section>
      <section className="investment-panel">
        <div className="investment-toolbar"><h2>{t.loans}</h2><Field label={t.filter}><Select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">{t.all}</option><option value="active">{t.active}</option><option value="paid">{t.repaid}</option></Select></Field></div>
        <ul className="investment-rows">{filtered.map((loan) => {
          const progress = repaidProgress(loan.originalCents, loan.balanceCents);
          const property = properties.find((p) => p.id === loan.propertyId);
          const unit = property?.units.find((u) => u.id === loan.unitId);
          return <li key={loan.id} className="investment-row">
            <div className="investment-row-main"><span className="crm-symbol"><Icon name="bank" size={22}/></span><div><h3><button className="investment-record-link" onClick={() => setSelected(loan.id)}>{loan.name}</button></h3><p>{property?.name}{unit ? ` · ${unit.name}` : ""}</p><p>{loan.bankName}</p></div></div>
            <div className="investment-row-values"><div><strong>{euros(paymentOf(loan), locale)}</strong><span>{t.payment}</span></div><Badge className={loan.balanceCents === 0 ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"}>{loan.balanceCents === 0 ? t.repaid : t.active}</Badge></div>
            <div className="investment-progress"><div><span>{t.repaidCapital}</span><strong>{progress.repaidPct === null ? "–" : formatPct(progress.repaidPct, locale)}</strong></div><progress aria-label={`${loan.name} · ${t.repaidCapital}`} max={100} value={progress.repaidPct ?? 0}/><div><span>{euros(loan.balanceCents, locale)} · {t.loanBalance}</span><span>{loan.remainingMonths} {t.monthsLeft}</span></div></div>
          </li>;
        })}</ul>
        {filtered.length === 0 && <p>{t.noMatch}</p>}
      </section>
      <PropertyCashflow locale={locale} properties={properties} records={records}/>
    </> : <section className="investment-panel investment-empty"><GlassHouse/><div><h2>{t.emptyTitle}</h2><p>{properties.length ? t.emptyHint : t.noProperty}</p>{properties.length ? !readOnly && <Button onClick={() => setEditing("new")}>{t.addLoan}</Button> : <Link href="/app/biens/nouveau" className="ui-button investment-link-button">{t.addProperty}</Link>}</div></section>}
    {unknown.length > 0 && <section className="investment-panel"><h2>{t.unknown}</h2><p>{t.unknownHint}</p><ul className="investment-rows">{unknown.map((p) => <li key={p.id} className="investment-row"><Link className="investment-record-link" href={`/app/biens/${p.id}`}>{p.name}</Link><span className="text-ink-soft">{t.unknown}</span></li>)}</ul></section>}
    <details className="investment-panel"><summary>{t.bankLinks}</summary><p>{t.bankLinksHint}</p><div className="investment-links">{LUXEMBOURG_LENDERS.map((b) => <a key={b.name} href={b.url} target="_blank" rel="noreferrer">{b.name}<Icon name="external" size={16}/></a>)}</div></details>
    {editing && <LoanEditor key={editing === "new" ? "new" : editing.id} loan={editing === "new" ? undefined : editing} properties={properties} locale={locale} onClose={() => setEditing(null)} onSave={async (draft, id) => {await onSave(draft, id); setEditing(null); setSaved(true);}}/>}
    {detail && <LoanDetail loan={detail} locale={locale} onClose={() => setSelected(null)} onEdit={readOnly ? undefined : () => {setSelected(null); setEditing(detail);}}/>}
  </div>;
}

function LoanEditor({loan, properties, locale, onClose, onSave}: {loan?: LoanRecord; properties: FinanceProperty[]; locale: Locale; onClose: () => void; onSave: Props["onSave"]}) {
  const t = getInvestmentCopy(locale);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const bankListId = useId();
  const discardCopy = getAcquisitionDict(locale);
  const [discard, setDiscard] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({propertyId: loan?.propertyId ?? properties[0]?.id ?? "", unitId: loan?.unitId ?? "", name: loan?.name ?? "", bankName: loan?.bankName ?? "", originalCents: loan ? String(loan.originalCents / 100) : "", balanceCents: loan ? String(loan.balanceCents / 100) : "", balanceDate: loan?.balanceDate ?? new Date().toISOString().slice(0, 10), annualRatePct: loan ? String(loan.annualRatePct) : "", rateType: loan?.rateType ?? "fixed", remainingMonths: loan ? String(loan.remainingMonths) : "", insuranceCents: loan ? String(loan.insuranceCents / 100) : "0", nextPaymentDate: loan?.nextPaymentDate ?? "", fixedUntil: loan?.fixedUntil ?? "", notes: loan?.notes ?? ""});
  const initialValues = useRef(values).current;
  const requestClose = () => {if (busy) return; if (JSON.stringify(values) !== JSON.stringify(initialValues)) setDiscard(true); else onClose();};
  const set = (name: string, value: string) => setValues((v) => ({...v, [name]: value, ...(name === "propertyId" ? {unitId: ""} : {})}));
  const parsed = () => loanSchema.safeParse({...values, unitId: values.unitId || null, originalCents: moneyInput(values.originalCents), balanceCents: moneyInput(values.balanceCents), annualRatePct: values.annualRatePct.trim() ? Number(values.annualRatePct.replace(",", ".")) : NaN, remainingMonths: values.remainingMonths.trim() ? Number(values.remainingMonths) : NaN, insuranceCents: moneyInput(values.insuranceCents), nextPaymentDate: values.nextPaymentDate || null, fixedUntil: values.fixedUntil || null});
  const steps = [t.stepProperty, t.stepBalance, t.stepReview];
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError("");
    if (step === 0) {if (!values.name.trim() || !values.bankName.trim() || !values.propertyId) {setError(t.invalid); return;} setStep(1); return;}
    const result = parsed();
    if (!result.success) {setError(t.invalid); if (step === 2) setStep(1); return;}
    if (step === 1) {setStep(2); return;}
    setBusy(true);
    try {await onSave(result.data, loan?.id);} catch {setError(t.failed);} finally {setBusy(false);}
  }
  const reviewed = parsed();
  return <Modal open onClose={requestClose} title={discard ? discardCopy.discardTitle : loan ? t.editLoan : t.addLoan} wide closeLabel={t.close}>
    {discard ? <div className="investment-form"><p>{discardCopy.discardBody}</p><div className="investment-toolbar"><Button onClick={() => setDiscard(false)}>{discardCopy.keepEditing}</Button><Button variant="secondary" onClick={onClose}>{discardCopy.discard}</Button></div></div> : <><ol className="investment-steps">{steps.map((s, i) => <li key={s} className="investment-step" aria-current={i === step ? "step" : undefined}><span>{i + 1}</span>{s}</li>)}</ol>
    <form ref={form} className="investment-workspace investment-form" onSubmit={submit}>
      <h2 ref={heading} tabIndex={-1}>{steps[step]}</h2>
      {step === 0 && <div className="investment-fields">
        <Field label={t.property}><Select value={values.propertyId} onChange={(e) => set("propertyId", e.target.value)} required>{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label={t.unit}><Select value={values.unitId} onChange={(e) => set("unitId", e.target.value)}><option value="">{t.wholeProperty}</option>{properties.find((p) => p.id === values.propertyId)?.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
        <Field label={t.name}><Input value={values.name} onChange={(e) => set("name", e.target.value)} required maxLength={160}/></Field>
        <Field label={t.bank}><Input list={bankListId} value={values.bankName} onChange={(e) => set("bankName", e.target.value)} required maxLength={160}/><datalist id={bankListId}>{LUXEMBOURG_LENDERS.map((b) => <option key={b.name} value={b.name}/>)}</datalist></Field>
      </div>}
      {step === 1 && <><p className="text-ink-soft">{t.paidHint}</p><div className="investment-fields">
        <MoneyEntry label={t.original} value={values.originalCents} onChange={(v) => set("originalCents", v)} required/>
        <MoneyEntry label={t.balance} value={values.balanceCents} onChange={(v) => set("balanceCents", v)} required/>
        <Field label={t.balanceDate}><Input type="date" value={values.balanceDate} max={new Date().toISOString().slice(0,10)} onChange={(e) => set("balanceDate", e.target.value)} required/></Field>
        <Field label={t.remaining}><Input type="number" min={0} max={600} step={1} value={values.remainingMonths} onChange={(e) => set("remainingMonths", e.target.value)} required/></Field>
        <Field label={t.rate}><Input inputMode="decimal" value={values.annualRatePct} onChange={(e) => set("annualRatePct", e.target.value)} required/></Field>
        <Field label={t.rateType}><Select value={values.rateType} onChange={(e) => set("rateType", e.target.value)}><option value="fixed">{t.fixed}</option><option value="variable">{t.variable}</option></Select></Field>
      </div><p className="text-ink-soft">{t.rateHint}</p><details><summary>{t.optional}</summary><div className="investment-fields mt-4">
        <MoneyEntry label={t.insurance} value={values.insuranceCents} onChange={(v) => set("insuranceCents", v)}/>
        <Field label={t.nextPayment}><Input type="date" value={values.nextPaymentDate} onChange={(e) => set("nextPaymentDate", e.target.value)}/></Field>
        <Field label={t.fixedUntil}><Input type="date" value={values.fixedUntil} onChange={(e) => set("fixedUntil", e.target.value)}/></Field>
        <Field label={t.notes}><Textarea value={values.notes} maxLength={4000} onChange={(e) => set("notes", e.target.value)}/></Field>
      </div></details></>}
      {step === 2 && reviewed.success && <div className="investment-review"><h3>{values.name}</h3><p>{properties.find((p) => p.id === values.propertyId)?.name} · {values.bankName}</p><dl><dt>{t.outstanding}</dt><dd>{euros(reviewed.data.balanceCents, locale)}</dd><dt>{t.payment}</dt><dd>{euros(amortize(reviewed.data).monthlyPaymentCents, locale)}</dd><dt>{t.remaining}</dt><dd>{values.remainingMonths}</dd><dt>{t.confirmedOn}</dt><dd>{formatDate(values.balanceDate, locale)}</dd></dl><p>{t.scheduleHint}</p></div>}
      {error && <InlineError>{error}</InlineError>}
      <div className="investment-toolbar"><Button variant="ghost" type="button" disabled={busy} onClick={step ? () => {setStep(step - 1); setError("");} : requestClose}>{step ? t.back : t.cancel}</Button><Button loading={busy} type="submit">{step === 2 ? t.save : t.next}</Button></div>
    </form></>}
  </Modal>;
}

export function MoneyEntry({label, value, onChange, required, hint}: {label: string; value: string; onChange: (value: string) => void; required?: boolean; hint?: string}) {
  return <Field label={label} hint={hint}><Input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} required={required}/></Field>;
}

function LoanDetail({loan, locale, onClose, onEdit}: {loan: LoanRecord; locale: Locale; onClose: () => void; onEdit?: () => void}) {
  const t = getInvestmentCopy(locale);
  const schedule = amortize(loan);
  const progress = repaidProgress(loan.originalCents, loan.balanceCents);
  return <Modal open onClose={onClose} title={loan.name} wide closeLabel={t.close}><div className="investment-workspace investment-detail">
    <p>{loan.bankName} · {t[loan.rateType]} · {formatPct(loan.annualRatePct, locale)}</p>
    <dl className="investment-stat investment-stat-primary"><dt>{t.outstanding}</dt><dd>{euros(loan.balanceCents, locale)}</dd><p>{t.confirmedOn} {formatDate(loan.balanceDate, locale)}</p></dl>
    {progress.balanceIncreased && <p role="note" className="text-amber-900">{t.increased}</p>}
    <div className="investment-progress"><div><span>{t.repaidCapital}</span><strong>{formatPct(progress.repaidPct ?? 0, locale)}</strong></div><progress max={100} value={progress.repaidPct ?? 0} aria-label={t.repaidCapital}/></div>
    <dl className="investment-review"><dt>{t.payment}</dt><dd>{euros(schedule.monthlyPaymentCents, locale)}</dd><dt>{t.insuranceLabel}</dt><dd>{euros(loan.insuranceCents, locale)}</dd><dt>{t.totalOutflow}</dt><dd>{euros(schedule.monthlyPaymentCents + loan.insuranceCents, locale)}</dd><dt>{t.remaining}</dt><dd>{loan.remainingMonths}</dd>{loan.nextPaymentDate && <><dt>{t.nextPayment}</dt><dd>{formatDate(loan.nextPaymentDate, locale)}</dd></>}{loan.fixedUntil && <><dt>{t.fixedUntil}</dt><dd>{formatDate(loan.fixedUntil, locale)}</dd></>}</dl>
    {loan.balanceCents > 0 && <BalanceChart loan={loan} locale={locale} t={t}/>}
    {loan.notes && <p className="whitespace-pre-wrap">{loan.notes}</p>}
    {onEdit && <Button onClick={onEdit}>{t.editLoan}</Button>}
  </div></Modal>;
}

function BalanceChart({loan, locale, t}: {loan: LoanRecord; locale: Locale; t: InvestmentCopy}) {
  const data = amortize(loan);
  const years = Array.from({length: Math.ceil(data.schedule.length / 12)}, (_, index) => {
    const rows = data.schedule.slice(index * 12, index * 12 + 12);
    return {year: index + 1, month: Math.min((index + 1) * 12, loan.remainingMonths), principal: rows.reduce((s, r) => s + r.principalCents, 0), interest: rows.reduce((s, r) => s + r.interestCents, 0), balance: rows.at(-1)!.balanceCents};
  });
  const points = [{month: 0, balance: loan.balanceCents}, ...years];
  const polyline = points.map(({balance, month}) => `${20 + month / loan.remainingMonths * 560},${180 - balance / loan.balanceCents * 150}`).join(" ");
  return <section className="investment-chart"><h3>{t.balanceTrend}</h3><p>{t.scheduleHint}</p><svg viewBox="0 0 600 210" role="img" aria-label={`${t.balanceTrend}: ${euros(loan.balanceCents, locale)} / ${loan.remainingMonths} ${t.monthsLeft}`}><path d="M20 30H580M20 105H580M20 180H580" stroke="currentColor" opacity=".15"/><polyline points={polyline} fill="none" stroke="currentColor" strokeWidth="3"/><text x="20" y="205" fontSize="14">0</text><text x="580" y="205" fontSize="14" textAnchor="end">{loan.remainingMonths}</text></svg><div className="flex flex-wrap justify-between gap-3"><span>{t.totalInterest}</span><strong>{euros(data.totalInterestCents, locale)}</strong></div><details><summary>{t.fullSchedule}</summary><div className="table-scroll"><table className="w-full text-sm"><caption className="sr-only">{t.schedule}</caption><thead><tr>{[t.year,t.principal,t.interest,t.loanBalance].map((v) => <th scope="col" key={v}>{v}</th>)}</tr></thead><tbody>{years.map((r) => <tr key={r.year}><th scope="row">{r.year}</th><td>{euros(r.principal,locale)}</td><td>{euros(r.interest,locale)}</td><td>{euros(r.balance,locale)}</td></tr>)}</tbody></table></div></details></section>;
}

function PropertyCashflow({locale, records, properties}: Pick<Props,"locale" | "records" | "properties">) {
  const t = getInvestmentCopy(locale);
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const [unitId, setUnitId] = useState("");
  const [costs, setCosts] = useState("");
  const [occupancy, setOccupancy] = useState("100");
  const [purchase, setPurchase] = useState("");
  const p = properties.find((item) => item.id === propertyId);
  const propertyLoans = records.filter((r) => r.propertyId === propertyId);
  const allocationMissing = Boolean(unitId && propertyLoans.some((r) => r.unitId === null && r.balanceCents > 0));
  const loans = propertyLoans.filter((r) => !unitId || r.unitId === unitId);
  const rentCents = unitId ? p?.units.find((u) => u.id === unitId)?.monthlyRentCents : p?.monthlyRentCents;
  const debt = loans.reduce((s, r) => s + paymentOf(r), 0);
  const insurance = loans.reduce((s, r) => s + r.insuranceCents, 0);
  const result = useMemo(() => {
    if (!p || allocationMissing || rentCents === undefined) return null;
    const cost = costs === "" ? 0 : moneyInput(costs);
    const acquisition = purchase === "" ? undefined : moneyInput(purchase);
    if (cost === null || acquisition === null || occupancy.trim() === "") return null;
    try {return investmentCashflow({monthlyRentCents: rentCents, occupancyPct: Number(occupancy.replace(",", ".")), monthlyOwnerCostsCents: cost, monthlyDebtCents: debt, monthlyInsuranceCents: insurance, totalAcquisitionCents: acquisition});} catch {return null;}
  }, [p, costs, purchase, occupancy, debt, insurance, allocationMissing, rentCents]);
  return <section className="investment-panel"><div className="investment-toolbar"><div><h2>{t.profitability}</h2><p>{t.profitabilityHint}</p></div></div><div className="investment-calculator"><div className="investment-form">
    <Field label={t.property}><Select value={propertyId} onChange={(e) => {setPropertyId(e.target.value); setUnitId(""); setCosts(""); setPurchase("");}}>{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
    <Field label={t.unit}><Select value={unitId} onChange={(e) => {setUnitId(e.target.value);setCosts("");setPurchase("");}}><option value="">{t.wholeProperty}</option>{p?.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
    <MoneyEntry label={t.ownerCosts} value={costs} onChange={setCosts} hint={t.costsHint}/>
    <div className="investment-fields"><Field label={t.occupancy}><Input type="number" min={0} max={100} value={occupancy} onChange={(e) => setOccupancy(e.target.value)}/></Field><MoneyEntry label={t.acquisitionCost} value={purchase} onChange={setPurchase}/></div>
  </div><div className="investment-result">{result ? <><dl className="investment-stat investment-stat-primary"><dt>{t.netCash}</dt><dd>{euros(result.cashflowCents, locale)}</dd><p>{costs === "" ? t.beforeCosts : t.afterCosts}</p></dl><dl className="investment-review"><dt>{t.rent}</dt><dd>{euros(result.effectiveRentCents, locale)}</dd><dt>{t.totalOutflow}</dt><dd>{euros(debt + insurance, locale)}</dd>{costs !== "" && result.netYieldPct !== null && <><dt>{t.netYield}</dt><dd>{formatPct(result.netYieldPct, locale)}</dd></>}</dl>{loans.length === 0 && <p>{t.noLoans}</p>}</> : <p>{allocationMissing ? t.allocationNeeded : t.resultMissing}</p>}</div></div><p className="mt-6 text-ink-soft">{unitId ? t.unitScopeHint : t.scopeHint}</p><p className="text-ink-soft">{t.notSaved}</p></section>;
}

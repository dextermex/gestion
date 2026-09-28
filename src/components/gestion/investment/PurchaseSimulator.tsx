"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Field, Input, InlineError, PageHeader } from "@/components/pro/ui";
import { amortize, investmentCashflow, nextPurchase } from "@/domain/investment";
import { moneyInput } from "@/lib/investment/loans";
import { getInvestmentCopy } from "@/lib/i18n/investment";
import type { Locale } from "@/lib/i18n/config";
import { euros, formatPct } from "@/lib/types";
import { MoneyEntry } from "./Loans";

export default function PurchaseSimulator({locale}: {locale: Locale}) {
  const t = getInvestmentCopy(locale);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const [step, setStep] = useState(0);
  useEffect(() => {if (firstRender.current) {firstRender.current = false; return;} heading.current?.focus();}, [step]);
  const [error, setError] = useState(false);
  const [v, setV] = useState<Record<string,string>>({price: "", loan: "", fees: "", works: "0", reserve: "", rate: "", years: "25", cash: "", saving: "", income: "", existingDebt: "0", rent: "0", costs: "0", occupancy: "100", stressRate: "2", insurance: "0"});
  const update = (key: string, value: string) => {setV((current) => ({...current, [key]: value})); setError(false);};
  const money = (key: string) => moneyInput(v[key]);
  const rate = v.rate.trim() ? Number(v.rate.replace(",", ".")) : NaN;
  const months = Number(v.years) * 12;
  const projectValid = ["price", "loan", "fees", "works", "reserve"].every((key) => money(key) !== null) && money("price")! > 0 && money("loan")! <= money("price")! + money("fees")! + money("works")! && Number.isFinite(rate) && rate >= 0 && rate <= 30 && Number.isInteger(months) && months > 0 && months <= 600;
  let result: {plan: ReturnType<typeof nextPurchase>; mortgage: ReturnType<typeof amortize>; stress: ReturnType<typeof amortize>; cashflow: ReturnType<typeof investmentCashflow>; ratio: number | null; cashCents: number} | null = null;
  try {
    const savingMagnitude = moneyInput(v.saving.replace(/^-/, ""));
    const saving = savingMagnitude === null ? null : (v.saving.startsWith("-") ? -savingMagnitude : savingMagnitude);
    const stress = v.stressRate.trim() ? Number(v.stressRate.replace(",", ".")) : NaN;
    if ((v.income === "" || money("income") !== null) && projectValid && ["cash", "existingDebt", "rent", "costs", "insurance"].every((key) => money(key) !== null) && saving !== null && stress >= 0 && stress <= 30 && v.occupancy.trim()) {
      const mortgage = amortize({balanceCents: money("loan")!, annualRatePct: rate, remainingMonths: money("loan") === 0 ? 0 : months});
      const monthlyInsuranceCents = money("insurance")!;
      result = {
        mortgage,
        stress: amortize({balanceCents: money("loan")!, annualRatePct: rate + stress, remainingMonths: money("loan") === 0 ? 0 : months}),
        plan: nextPurchase({priceCents: money("price")!, loanCents: money("loan")!, feesCents: money("fees")!, worksCents: money("works")!, reserveCents: money("reserve")!, availableCashCents: money("cash")!, monthlySavingCents: saving}),
        cashflow: investmentCashflow({monthlyRentCents: money("rent")!, occupancyPct: Number(v.occupancy), monthlyOwnerCostsCents: money("costs")!, monthlyDebtCents: mortgage.monthlyPaymentCents, monthlyInsuranceCents, totalAcquisitionCents: money("price")! + money("fees")! + money("works")!}),
        ratio: money("income") ? (money("existingDebt")! + mortgage.monthlyPaymentCents) / money("income")! * 100 : null,
        cashCents: money("cash")!,
      };
    }
  } catch { result = null; }
  const steps = [t.projectStep, t.budgetStep, t.resultStep];
  return <div className="investment-workspace">
    <PageHeader title={t.simulator} subtitle={t.simulatorHint} actions={<Link href="/app/emprunts" className="investment-link-button ui-button">{t.loans}</Link>}/>
    <section className="investment-panel">
      <ol className="investment-steps">{steps.map((label, i) => <li className="investment-step" aria-current={step === i ? "step" : undefined} key={label}><span>{i+1}</span>{label}</li>)}</ol>
      {step < 2 ? <form className="investment-form max-w-3xl mx-auto" onSubmit={(e) => {e.preventDefault(); if (step === 0 ? projectValid : result) {setError(false); setStep(step + 1);} else setError(true);}}>
        <h2 ref={heading} tabIndex={-1}>{steps[step]}</h2>
        {step === 0 ? <>
          <div className="investment-fields"><MoneyEntry label={t.price} value={v.price} onChange={(x) => update("price",x)} required/><MoneyEntry label={t.proposedLoan} value={v.loan} onChange={(x) => update("loan",x)} required/></div>
          <MoneyEntry label={t.fees} hint={t.feesHint} value={v.fees} onChange={(x) => update("fees",x)} required/>
          <div className="investment-fields"><MoneyEntry label={t.works} value={v.works} onChange={(x) => update("works",x)} required/><MoneyEntry label={t.reserve} value={v.reserve} onChange={(x) => update("reserve",x)} required/>
            <Field label={t.rate}><Input inputMode="decimal" value={v.rate} onChange={(e) => update("rate", e.target.value)} required/></Field><Field label={t.term}><Input type="number" min={1} max={50} step={1} value={v.years} onChange={(e) => update("years", e.target.value)} required/></Field></div>
        </> : <>
          <MoneyEntry label={t.cash} value={v.cash} onChange={(x) => update("cash",x)} required/>
          <MoneyEntry label={t.saving} hint={t.savingHint} value={v.saving} onChange={(x) => update("saving",x)} required/>
          <div className="investment-fields"><MoneyEntry label={t.income} value={v.income} onChange={(x) => update("income",x)}/><MoneyEntry label={t.existingDebt} value={v.existingDebt} onChange={(x) => update("existingDebt",x)} required/></div>
          <details><summary>{t.profitability}</summary><div className="investment-fields mt-4"><MoneyEntry label={t.expectedRent} value={v.rent} onChange={(x) => update("rent",x)}/><MoneyEntry label={t.ownerCosts} value={v.costs} onChange={(x) => update("costs",x)}/><MoneyEntry label={t.insurance} value={v.insurance} onChange={(x) => update("insurance",x)}/><Field label={t.occupancy}><Input type="number" min={0} max={100} value={v.occupancy} onChange={(e) => update("occupancy",e.target.value)}/></Field><Field label={t.stressRate}><Input type="number" min={0} max={30} step="0.1" value={v.stressRate} onChange={(e) => update("stressRate",e.target.value)}/></Field></div></details>
        </>}
        {error && <InlineError>{t.invalid}</InlineError>}
        <div className="investment-toolbar">{step ? <Button type="button" variant="ghost" onClick={() => {setStep(0);setError(false);}}>{t.back}</Button> : <span/>}<Button type="submit">{step === 0 ? t.next : t.calculate}</Button></div>
      </form> : result && <div className="investment-detail">
        <div className="investment-summary"><div className="investment-stat investment-stat-primary"><h2 ref={heading} tabIndex={-1}>{result.plan.months === 0 ? t.targetReached : result.plan.months === null ? t.notReached : <><span className="block text-5xl mb-3 tabular-nums">{result.plan.months}</span>{t.targetMonths}</>}</h2><p>{t.notAnApproval}</p></div><dl className="investment-stat"><dt>{t.gap}</dt><dd>{euros(result.plan.gapCents,locale)}</dd></dl></div>
        <div className="investment-progress"><div><span>{t.cashTarget}</span><strong>{euros(result.plan.targetCents,locale)}</strong></div><progress max={Math.max(1,result.plan.targetCents)} value={result.plan.targetCents === 0 ? 1 : Math.min(result.cashCents,result.plan.targetCents)} aria-label={t.cashTarget}/></div>
        <div className="investment-calculator"><section className="investment-result"><dl className="investment-stat"><dt>{t.monthlyEstimate}</dt><dd>{euros(result.mortgage.monthlyPaymentCents,locale)}</dd></dl><dl className="investment-review"><dt>{t.totalInterest}</dt><dd>{euros(result.mortgage.totalInterestCents,locale)}</dd><dt>{t.stress} (+{v.stressRate} {t.ratePoints})</dt><dd>{euros(result.stress.monthlyPaymentCents,locale)}</dd>{result.ratio !== null && <><dt>{t.debtRatio}</dt><dd>{formatPct(result.ratio,locale)}</dd></>}</dl><p>{t.ratioHint}</p></section>
          <section className="investment-result"><dl className="investment-stat"><dt>{t.netCash}</dt><dd>{euros(result.cashflow.cashflowCents,locale)}</dd></dl><p>{t.afterCosts}</p><dl className="investment-review"><dt>{t.rent}</dt><dd>{euros(result.cashflow.effectiveRentCents,locale)}</dd><dt>{t.netYield}</dt><dd>{formatPct(result.cashflow.netYieldPct ?? 0,locale)}</dd></dl></section></div>
        <p>{t.scenarioNote}</p><Button variant="secondary" onClick={() => setStep(0)}>{t.change}</Button>
      </div>}
    </section>
    <p className="text-ink-soft">{t.notSaved}</p>
    <details className="investment-panel"><summary>{t.sources}</summary><p>{t.sourcesHint}</p><div className="investment-links">
      <a href="https://www.cssf.lu/en/mortgage-credit-agreements/" target="_blank" rel="noreferrer">{t.sourceCssf}</a>
      <a href="https://www.notariat.lu/actes-notaries" target="_blank" rel="noreferrer">{t.sourceNotary}</a>
      <a href="https://www.athome.lu/en/finance/mortgage/simulation-result" target="_blank" rel="noreferrer">{t.sourceAthome}</a>
      <a href="https://guichet.public.lu/en/citoyens/fiscalite/immobilier/achat-vente-donation/credit-impot-actes-notaries.html" target="_blank" rel="noreferrer">{t.sourceFees}</a>
    </div></details>
  </div>;
}

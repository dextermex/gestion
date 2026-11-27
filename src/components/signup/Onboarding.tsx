"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { fmt, plural, type Locale } from "@/lib/i18n/config";
import type { SignupCopy } from "@/lib/i18n/signup";
import { RENT_BANDS, TRIAL_DAYS, type Rhythm } from "@/domain/billing/pricing";
import { price } from "@/lib/billing/format";
import { unitsFromAnswer, WINBACK_PCT, type Offer, type UnitsAnswer } from "@/lib/signup/offer";
import { EMOJI, optionsOf, type Challenge, type QuizAnswers, type QuizStep } from "@/lib/signup/quiz";
import { HORIZONS, WATCHES, WIDGETS, type Horizon, type Watch, type Widget } from "@/lib/signup/dashboard";
import { REMINDER_DAY, priceLine, winbackLine } from "@/lib/signup/flow";
import { averageStars, type Testimonial } from "@/lib/signup/reviews";

/**
 * The screens of the sign-up after the account, the iPhone app's
 * (`app/(onboarding)/*.tsx`) laid out for the funnel's centred column:
 * the questions with an emoji per answer, the interests as chips, the
 * first month as a rising curve, the count while the space is created,
 * the plan, the three trial screens and the one-time offer. The funnel
 * (SignupFunnel.tsx) holds the state and the calls; these only draw.
 */


/** A label quoted inside a sentence: lowercased at its start in French and English, as written in German and Luxembourgish (their nouns keep the capital). */
export const midSentence = (s: string, locale: Locale) => (locale === "de" || locale === "lu" ? s : s.charAt(0).toLowerCase() + s.slice(1));

/** The labels of a question's answers, in its order. */
export function questionOptions(c: SignupCopy, step: QuizStep): { value: string; label: string; description?: string; emoji: string }[] {
  const q = c.onboarding.quiz;
  return optionsOf(step).map((value, i) => {
    switch (step) {
      case "rent": return { value, label: q.rent.options[i], emoji: EMOJI.rent[i] };
      case "time": return { value, label: c.involvement[i], emoji: EMOJI.time[i] };
      case "challenge": {
        const option = q.challenge.options[value as Challenge];
        return { value, label: option.label, description: option.sub, emoji: EMOJI.challenge[value as Challenge] };
      }
      default: {
        const options = q[step].options as Record<string, string>;
        return { value, label: options[value], emoji: (EMOJI[step] as Record<string, string>)[value] };
      }
    }
  });
}

/** One question: the answers as radio rows, an emoji each. Arrow keys move between them, Enter continues. */
export function QuizChoices({ c, step, selected, onSelect }: { c: SignupCopy; step: QuizStep; selected: string | null; onSelect: (value: string) => void }) {
  return <fieldset className="signup-choices signup-quiz" aria-labelledby="signup-title">
    <legend className="sr-only">{c.onboarding.quiz[step].title}</legend>
    {questionOptions(c, step).map((option) => <label key={option.value} className="signup-choice" data-selected={selected === option.value}>
      <input type="radio" name={"quiz-" + step} value={option.value} checked={selected === option.value} onChange={() => onSelect(option.value)} />
      <span className="signup-choice-emoji" aria-hidden="true">{option.emoji}</span>
      <span className="signup-choice-copy"><span>{option.label}</span>{option.description && <small>{option.description}</small>}</span>
    </label>)}
  </fieldset>;
}

export interface InterestsValue { first: Widget[]; horizon: Horizon | null; watch: Watch[] }

const WIDGET_EMOJI: Record<Widget, string> = { arrears: "💶", cashflow: "📈", actions: "📌", costs: "🧾", requests: "🛠️", activity: "🕒" };
const HORIZON_EMOJI: Record<Horizon, string> = { month: "📅", year: "🔭" };
const WATCH_EMOJI: Record<Watch, string> = { arrears: "⏳", vacancy: "🚪", edl_exit: "📋", ticket: "⚠️", invite: "✉️" };
const flip = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

/** The last question: three short groups of chips, each answer changing the home screen. */
export function InterestsChips({ c, value, onChange }: { c: SignupCopy; value: InterestsValue; onChange: (value: InterestsValue) => void }) {
  const k = c.onboarding.interests;
  return <div className="signup-interests">
    <fieldset>
      <legend>{k.groups.first}</legend>
      <div className="signup-chips">{WIDGETS.map((w) => <label key={w} className="signup-chip" data-on={value.first.includes(w)}>
        <input type="checkbox" checked={value.first.includes(w)} onChange={() => onChange({ ...value, first: flip(value.first, w) })} />
        <span aria-hidden="true">{WIDGET_EMOJI[w]}</span>{k.chips[w]}
      </label>)}</div>
    </fieldset>
    <fieldset>
      <legend>{k.groups.horizon}</legend>
      <div className="signup-chips">{HORIZONS.map((h) => <label key={h} className="signup-chip" data-on={value.horizon === h}>
        <input type="radio" name="horizon" checked={value.horizon === h} onChange={() => onChange({ ...value, horizon: h })} />
        <span aria-hidden="true">{HORIZON_EMOJI[h]}</span>{k.horizons[h]}
      </label>)}</div>
    </fieldset>
    <fieldset>
      <legend>{k.groups.watch}</legend>
      <div className="signup-chips">{WATCHES.map((w) => <label key={w} className="signup-chip" data-on={value.watch.includes(w)}>
        <input type="checkbox" checked={value.watch.includes(w)} onChange={() => onChange({ ...value, watch: flip(value.watch, w) })} />
        <span aria-hidden="true">{WATCH_EMOJI[w]}</span>{k.watches[w]}
      </label>)}</div>
    </fieldset>
  </div>;
}

/** How many choices the interests hold, for the button ("Continuer · 3 choisis"). */
export const interestsCount = (v: InterestsValue) => v.first.length + v.watch.length + (v.horizon ? 1 : 0);
export const chosenLabel = (c: SignupCopy, locale: Locale, n: number) => plural(locale, n, c.onboarding.interests.chosen.one, c.onboarding.interests.chosen.many);

// Three points, rising: week 1, week 2, month 1. The curve is the product's own sequence, not a prediction.
const CURVE = { w: 320, h: 150, line: "M24 118 C 92 112, 110 84, 160 86 S 250 40, 296 28", points: [[24, 118], [160, 86], [296, 28]] as const };

/** "Vous avez tout pour y arriver": the first month as a rising curve, drawn in SVG; each point is something the product does. */
export function PotentialCurve({ c }: { c: SignupCopy }) {
  const k = c.onboarding.potential;
  const steps = [{ day: k.steps.w1, body: k.steps.w1Body }, { day: k.steps.w2, body: k.steps.w2Body }, { day: k.steps.m1, body: k.steps.m1Body }];
  return <figure className="signup-curve" aria-label={`${k.chart}. ${steps.map((s) => `${s.day} · ${s.body}`).join(". ")}`}>
    <figcaption>{k.chart}</figcaption>
    <svg viewBox={`0 0 ${CURVE.w} ${CURVE.h}`} role="presentation" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <defs><linearGradient id="signup-rise" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".28" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
      <path d={`${CURVE.line} L 296 ${CURVE.h} L 24 ${CURVE.h} Z`} fill="url(#signup-rise)" className="signup-curve-fill" />
      <path d={CURVE.line} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" pathLength={1} className="signup-curve-line" />
      {CURVE.points.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i === 2 ? 8 : 6} className={i === 2 ? "signup-curve-end" : "signup-curve-dot"} />)}
    </svg>
    <div className="signup-curve-axis" aria-hidden="true">{steps.map((s) => <span key={s.day}>{s.day}</span>)}</div>
    <ul>{steps.map((s, i) => <li key={s.day} data-last={i === 2 || undefined}><strong>{s.day} · </strong>{s.body}</li>)}</ul>
  </figure>;
}

/** Landlords' quotes and their average, only ever drawn from a real list (the funnel skips the step while it is empty). */
export function ReviewsWall({ c, locale, list }: { c: SignupCopy; locale: Locale; list: readonly Testimonial[] }) {
  const average = averageStars(list).toLocaleString(locale === "en" ? "en-GB" : "fr-LU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return <div className="signup-reviews">
    <p className="signup-reviews-figure"><strong>{average}</strong><span>{c.onboarding.reviews.rating}</span></p>
    <ul>{list.slice(0, 4).map((r) => <li key={r.name + r.place}>
      <p><strong>{r.lead[locale]} </strong>{r.quote[locale]}</p>
      <span>{r.name} · {r.place}</span>
    </li>)}</ul>
  </div>;
}

/** "Nous créons votre espace": the figure counting to 100 and what is built from the answers, each line ticking as the figure passes it. */
export function SetupCount({ pct, items, label }: { pct: number; items: string[]; label: string }) {
  return <div className="signup-setup">
    <p className="signup-setup-figure" aria-hidden="true">{pct} %</p>
    <div className="signup-setup-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></div>
    <ul>{items.map((item, i) => {
      const done = pct >= ((i + 1) / items.length) * 100 - 1;
      return <li key={item} data-done={done || undefined}><span className="signup-setup-check" aria-hidden="true">{done && <CheckMark />}</span>{item}</li>;
    })}</ul>
  </div>;
}

function CheckMark() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>;
}

/** "Votre plan est prêt": what Morada does about the difficulty named, and the order the home screen opens in. No price. */
export function PlanReady({ c, locale, challenge, goal, sections }: { c: SignupCopy; locale: Locale; challenge: Challenge; goal: QuizAnswers["goal"]; sections: Widget[] }) {
  const k = c.onboarding.ready;
  return <div className="signup-plan-ready">
    {goal && <p className="signup-goal">{fmt(k.goal, { goal: midSentence(c.onboarding.quiz.goal.options[goal], locale) })}</p>}
    <ul>{k.rows[challenge].map((line) => <li key={line}><span className="signup-setup-check" data-done aria-hidden="true"><CheckMark /></span>{line}</li>)}</ul>
    <p className="signup-plan-home">{`${k.home} · ${sections.map((w) => c.onboarding.interests.chips[w]).join(" · ")}`}</p>
  </div>;
}

/** A real picture of the product: Accueil on the sample workspace, captured in the iPhone app, in the person's language. */
export function ProductShot({ locale, alt }: { locale: Locale; alt: string }) {
  return <div className="signup-shot"><Image src={`/signup/home-${locale}.jpg`} alt={alt} width={440} height={956} sizes="(max-width: 600px) 62vw, 260px" /></div>;
}

/** The bell with its badge: the reminder e-mail before the trial ends. */
export function ReminderBell() {
  return <div className="signup-bell" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5a6.5 6.5 0 0 0-6.5 6.5v3.6l-1.7 3.1A1 1 0 0 0 4.7 17h14.6a1 1 0 0 0 .9-1.3l-1.7-3.1V9A6.5 6.5 0 0 0 12 2.5Zm-2.7 15.8a2.8 2.8 0 0 0 5.4 0Z" /></svg>
    <span>1</span>
  </div>;
}

/** The trial as three dated rows: today, the reminder, the day the subscription starts. */
export function TrialRows({ c }: { c: SignupCopy }) {
  const k = c.onboarding.offer.tl;
  const rows = [
    { title: k.today, body: k.todayBody },
    { title: fmt(k.inDays, { days: REMINDER_DAY }), body: k.remindBody },
    { title: fmt(k.inDays, { days: TRIAL_DAYS }), body: k.startBody },
  ];
  return <ol className="signup-trial-rows">{rows.map((row, i) => <li key={row.title} data-first={i === 0 || undefined}>
    <span className="signup-trial-dot" aria-hidden="true" />
    <strong>{row.title}</strong>
    <span>{row.body}</span>
  </li>)}</ol>;
}

/** "Essayez 30 jours gratuitement, puis 420 € par an (35 € par mois)", or the price alone when the free days were used. */
export function priceSentence(c: SignupCopy, locale: Locale, offer: Offer, trial: boolean): { lead: string; amount: string; tail: string } {
  const k = c.onboarding.offer;
  const { perPeriod, monthly } = priceLine(offer);
  return {
    lead: trial ? fmt(k.tryThen, { days: TRIAL_DAYS }) : "",
    amount: `${price(perPeriod, locale)} ${offer.billing === "year" ? k.periodYear : k.periodQuarter}`,
    tail: fmt(k.monthlyEq, { amount: price(monthly, locale) }),
  };
}

export function PriceLine({ c, locale, offer, trial }: { c: SignupCopy; locale: Locale; offer: Offer; trial: boolean }) {
  const line = priceSentence(c, locale, offer, trial);
  return <p className="signup-price-line" data-price-line>{line.lead && <>{line.lead} </>}<strong>{line.amount}</strong> {line.tail}</p>;
}

/** "Tarif pour 3 lots · Comprendre mon tarif": the lots quoted and the way into the panel. */
export function UnderstandLink({ c, locale, units, open, onOpen }: { c: SignupCopy; locale: Locale; units: number; open: boolean; onOpen: () => void }) {
  const k = c.onboarding.offer;
  return <p className="signup-understand">{fmt(k.priceFor, { units: plural(locale, units, k.lots.one, k.lots.many) })} · <button type="button" className="signup-inline-button" aria-haspopup="dialog" aria-expanded={open} onClick={onOpen}>{k.understand}</button></p>;
}

const ADJUST_UNITS: Exclude<UnitsAnswer, "0">[] = ["1", "2-5", "6-10", "11-20", "21-50"];

/**
 * "Comprendre mon tarif": how the price is made and the answers it comes
 * from, each a choice that changes the price at once (the lots bracket, the
 * rent band and, on the offer, yearly or quarterly with "2 mois offerts" on
 * the year). A native dialog, opened on the open transition only.
 */
export function PricePanel({ c, locale, open, onClose, units, band, billing, onUnits, onBand, onBilling, result, resultLabel }: {
  c: SignupCopy; locale: Locale; open: boolean; onClose: () => void;
  units: number; band: number; billing?: Rhythm;
  onUnits: (answer: UnitsAnswer) => void; onBand: (band: number) => void; onBilling?: (billing: Rhythm) => void;
  result: string; resultLabel: string;
}) {
  const k = c.onboarding.offer;
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  return <dialog ref={dialog} className="signup-confirm-dialog signup-price-panel" aria-labelledby="price-panel-title" onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === dialog.current) onClose(); }}>
    <h2 id="price-panel-title" className="font-display font-bold">{k.scalesTitle}</h2>
    <p className="signup-panel-rule">{fmt(k.perUnitLine, { perUnit: price(RENT_BANDS[Math.min(band, RENT_BANDS.length - 1)].perLot, locale) })}</p>
    <fieldset className="signup-panel-group">
      <legend>{k.adjustLots}</legend>
      <div className="signup-chips">{ADJUST_UNITS.map((a) => <label key={a} className="signup-chip" data-on={unitsFromAnswer(a) === units}>
        <input type="radio" name="panel-units" checked={unitsFromAnswer(a) === units} onChange={() => onUnits(a)} />{c.onboarding.quiz.units.options[a]}
      </label>)}</div>
    </fieldset>
    <fieldset className="signup-panel-group">
      <legend>{k.adjustRent}</legend>
      <div className="signup-chips">{c.onboarding.quiz.rent.options.map((label, b) => <label key={label} className="signup-chip" data-on={b === band}>
        <input type="radio" name="panel-band" checked={b === band} onChange={() => onBand(b)} />{label}
      </label>)}</div>
    </fieldset>
    {billing && onBilling && <fieldset className="signup-panel-group">
      <legend>{k.rhythm}</legend>
      <div className="signup-chips">{(["year", "quarter"] as const).map((r) => <label key={r} className="signup-chip" data-on={r === billing} data-rhythm={r}>
        <input type="radio" name="panel-billing" checked={r === billing} onChange={() => onBilling(r)} />{r === "year" ? `${k.plans.year} · ${k.twoMonths}` : k.plans.quarter}
      </label>)}</div>
    </fieldset>}
    <div className="signup-panel-foot">
      <div><small>{resultLabel}</small><strong data-panel-result>{result}</strong></div>
      <button type="button" className="signup-panel-done" onClick={onClose}>{k.done}</button>
    </div>
    <p className="signup-panel-note">{k.launchNote}</p>
  </dialog>;
}

/** The one-time offer's card: the yearly plan with a quarter off its first year, the full price struck through. */
export function WinbackCard({ c, locale, offer, trial }: { c: SignupCopy; locale: Locale; offer: Offer; trial: boolean }) {
  const k = c.onboarding.winback;
  const line = winbackLine(offer);
  return <div className="signup-winback-card">
    <div className="signup-winback-head"><span>{k.plan}</span>{trial && <span className="signup-zero">{c.onboarding.offer.noPayment}</span>}</div>
    <p className="signup-winback-price"><strong>{price(line.monthly, locale)}</strong><span>{k.perMonth}</span><s>{price(line.fullMonthly, locale)}</s></p>
    <p className="signup-winback-under">{fmt(k.firstYear, { amount: price(line.firstYear, locale), full: price(line.fullYear, locale) })}</p>
  </div>;
}

export const winbackBadge = (c: SignupCopy) => fmt(c.onboarding.winback.badge, { pct: WINBACK_PCT });

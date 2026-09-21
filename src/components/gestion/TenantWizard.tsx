"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button, Field, Input, Select } from "@/components/pro/ui";
import { WizardFooter } from "@/components/gestion/WizardChrome";
import { Icon } from "@/components/pro/icons";
import type { Dict } from "@/lib/i18n/fr";
import {
  RENTAL_TOTAL,
  canLeave,
  isFirstStep,
  nextStep,
  prevStep,
  stepNumber,
  type RentalStep,
} from "@/lib/gestion/rental-flow";

/**
 * Putting a tenant into a lot, as a conversation the owner can pause.
 *
 * The owner started from the lot, so the lot is never asked for again. Nine
 * steps: the people, the lease, the rent, the account the rent will arrive
 * from, the guarantee, the inventory, the insurance, the documents, and the
 * activation. Every step offers the same three moves: back, save and
 * continue later, next. Moving on saves; saving writes the dossier to the
 * lease row as a draft, which is why closing the tab, refreshing or signing
 * out loses nothing, and why the property can say "Dossier en préparation ·
 * 3/9 étapes" and reopen the dossier at its first incomplete step.
 *
 * Nothing before the last step makes the rental active. The ninth step,
 * Activation, is the only doorway: until then the lot is free and no rent
 * falls due.
 *
 * A lease is signed by everyone who moves in. A couple, a family or three
 * roommates are each a tenant in their own right on the same lease, which is
 * why the first step is a list of people rather than a person.
 */

export type Person = { contactId: string | null; firstName: string; lastName: string; email: string; phone: string };

type LeaseStatus = "draft" | "active" | "notice" | "ended";

const blankPerson = (): Person => ({ contactId: null, firstName: "", lastName: "", email: "", phone: "" });
const hasName = (p: Person): boolean => p.firstName.trim() !== "" || p.lastName.trim() !== "";

type Props = {
  d: Dict;
  unitLabel: string;
  propertyName: string;
  propertyId: string;
  unitId: string;
  /** Real account: the flow writes the dossier to the database as it goes. */
  real: boolean;
  notice: string;
  /** What the law allows for the guarantee, by lease type, resolved by the
   *  parameter registry on the server so the step can say it. */
  depositMax: { residential: number; commercial: number };
  /** Resuming a dossier that already exists: its id, what it already holds,
   *  and which steps it has completed, so the flow reopens filled in. */
  existing?: {
    leaseId: string;
    status: LeaseStatus;
    startStep: RentalStep;
    completed: RentalStep[];
    tenants: Person[];
    colocation: boolean;
    type: "residential" | "commercial";
    startDate: string;
    endDate: string;
    rent: string;
    charges: string;
    paymentDay: string;
    payerName: string;
    payerIban: string;
    depositMonths: string;
    depositForm: string;
    hasInspection: boolean;
    hasInsurance: boolean;
  };
};

export default function TenantWizard({
  d,
  unitLabel,
  propertyName,
  propertyId,
  unitId,
  real,
  notice,
  depositMax,
  existing,
}: Props) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [step, setStep] = useState<RentalStep>(existing?.startStep ?? "tenant");
  const [saving, setSaving] = useState(false);
  // Which move the save belongs to, so only that button shows it.
  const [leaving, setLeaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [leaseId, setLeaseId] = useState<string | null>(existing?.leaseId ?? null);
  const [completed, setCompleted] = useState<RentalStep[]>(existing?.completed ?? []);
  // What the written lease still lacks, as the legal engine said it at the
  // last save. Informative: the rental runs regardless once activated.
  const [compliance, setCompliance] = useState<string[]>([]);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  const [people, setPeople] = useState<Person[]>(
    existing && existing.tenants.length > 0 ? existing.tenants : [blankPerson()],
  );
  const [colocation, setColocation] = useState(existing?.colocation ?? false);

  const [type, setType] = useState<"residential" | "commercial">(existing?.type ?? "residential");
  const [startDate, setStartDate] = useState(existing?.startDate ?? (() => new Date().toISOString().slice(0, 10))());
  const [endDate, setEndDate] = useState(existing?.endDate ?? "");

  const [rent, setRent] = useState(existing?.rent ?? "");
  const [charges, setCharges] = useState(existing?.charges ?? "");
  const [paymentDay, setPaymentDay] = useState(existing?.paymentDay ?? "1");

  const [payerName, setPayerName] = useState(existing?.payerName ?? "");
  const [payerIban, setPayerIban] = useState(existing?.payerIban ?? "");

  const [edlDone, setEdlDone] = useState(existing?.hasInspection ?? false);
  const [insurer, setInsurer] = useState("");
  const [insurancePolicy, setInsurancePolicy] = useState("");
  const [insuranceExpires, setInsuranceExpires] = useState("");
  const [insuranceDone, setInsuranceDone] = useState(existing?.hasInsurance ?? false);

  // The guarantee is pre-filled ("yes, two months") until the owner has been
  // through its step; only then is a dossier without a deposit read as "no".
  const guaranteeAnswered = existing?.completed.includes("guarantee") ?? false;
  const [hasDeposit, setHasDeposit] = useState(existing && guaranteeAnswered ? existing.depositMonths !== "0" : true);
  const [depositMonths, setDepositMonths] = useState(existing && existing.depositMonths !== "0" ? existing.depositMonths : "2");
  const [depositForm, setDepositForm] = useState(existing?.depositForm ?? "cash");

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const nameOk = people.some(hasName);
  const rentOk = rent.trim() !== "" && rent.trim() !== "0";
  const named = people.filter(hasName);
  const filled = { tenant: nameOk, rent: rentOk };

  const setPerson = (i: number, patch: Partial<Person>) =>
    setPeople((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const removePerson = (i: number) => {
    setPeople((list) => (list.length > 1 ? list.filter((_, j) => j !== i) : list));
    if (people.length <= 2) setColocation(false);
  };

  // The live total is the whole point of this step: what the tenant will
  // actually transfer each month.
  const toNumber = (v: string) => {
    const n = Number(v.replace(/[\s €]/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };
  const total = toNumber(rent) + toNumber(charges);
  const totalPreview = total > 0 ? total.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null;

  /** The URL always names the dossier and the step, so a refresh lands here. */
  const syncUrl = (id: string | null, at: RentalStep) => {
    if (typeof window === "undefined" || !id) return;
    window.history.replaceState(window.history.state, "", `/app/biens/locataire?bail=${id}&etape=${stepNumber(at)}`);
  };

  /**
   * Writes the dossier as it stands, from the step the owner is on, and
   * answers with its id (null when nothing was written). The server decides
   * what counts as completed; the wizard only reports. On the first save the
   * dossier comes into existence and the URL learns its id.
   */
  const save = async (from: RentalStep): Promise<string | null> => {
    setSaving(true);
    setSaveError(null);
    // The guarantee is the owner's answer, not the form's pre-filled one: it
    // is written only once the guarantee step has been reached.
    const guaranteeReached = completed.includes("guarantee") || stepNumber(from) >= stepNumber("guarantee");
    try {
      const res = await fetch("/api/locations/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaseId,
          unitId,
          step: from,
          tenants: named,
          colocation: named.length > 1 && colocation,
          type,
          startDate,
          endDate: endDate || undefined,
          rent,
          charges,
          paymentDay,
          payerName,
          payerIban,
          depositMonths: guaranteeReached && hasDeposit ? depositMonths : 0,
          depositForm,
        }),
      });
      if (res.status === 401) {
        const here = `/app/biens/locataire?${leaseId ? `bail=${leaseId}` : `lot=${unitId}`}`;
        window.location.assign(`/connexion?next=${encodeURIComponent(here)}`);
        return null;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveError(data.error === "already_let" ? d.location.alreadyLet : data.error === "email_taken" ? d.modify.emailTaken : d.location.saveFailed);
        return null;
      }
      const saved = (await res.json()) as {
        leaseId: string;
        contactIds: string[];
        completed: RentalStep[];
        issues?: Array<{ message: string }>;
      };
      setLeaseId(saved.leaseId);
      setCompleted(saved.completed);
      setCompliance((saved.issues ?? []).map((i) => i.message));
      // The people now have their contact ids, so the next save updates
      // rather than creates them.
      setPeople((list) => {
        let k = 0;
        return list.map((p) => (hasName(p) ? { ...p, contactId: saved.contactIds[k++] ?? p.contactId } : p));
      });
      return saved.leaseId;
    } catch {
      setSaveError(d.location.saveFailed);
      return null;
    } finally {
      setSaving(false);
    }
  };
  const busy = saving || activating;

  /** The rental becomes active: the one move that changes the lot's state. */
  const activate = async () => {
    setActivating(true);
    setActivateError(null);
    try {
      const id = await save("activation");
      if (!id) return;
      const res = await fetch(`/api/baux/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate" }),
      });
      if (res.ok) {
        router.push(`/app/biens/${propertyId}?onglet=location&lot=${unitId}`);
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setActivateError(data.error === "incomplete" ? d.location.activationIncomplete : d.bien.draftActivateFailed);
    } catch {
      setActivateError(d.bien.draftActivateFailed);
    } finally {
      setActivating(false);
    }
  };

  /**
   * Moving on. Leaving a step saves the dossier first, then advances to the
   * very next step. Nothing here inspects whether a section was filled in to
   * decide which step comes next: that is what used to lose steps.
   */
  const advance = async () => {
    if (busy) return;
    if (!canLeave(step, filled)) return;
    let id = leaseId;
    if (real) {
      id = await save(step);
      if (!id) return;
    }
    const to = nextStep(step);
    setStep(to);
    syncUrl(id, to);
  };

  /**
   * Leaving the insurance step records the policy the owner typed, if any,
   * as its own row, then moves on like every other step.
   */
  const advanceInsurance = async () => {
    if (busy) return;
    if (real && leaseId && insurer.trim() !== "" && !insuranceDone) {
      setSaving(true);
      try {
        const res = await fetch("/api/assurances/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leaseId,
            kind: "rent_guarantee",
            provider: insurer,
            policyNumber: insurancePolicy,
            expiresOn: insuranceExpires,
          }),
        });
        if (res.ok) setInsuranceDone(true);
      } finally {
        setSaving(false);
      }
    }
    await advance();
  };

  const back = () => {
    if (busy) return;
    const to = prevStep(step);
    setStep(to);
    syncUrl(leaseId, to);
  };

  /** Stop here: the dossier is saved as a draft and the owner is back on the property. */
  const saveAndLeave = async () => {
    if (busy) return;
    setLeaving(true);
    try {
      if (real && !(await save(step))) return;
    } finally {
      setLeaving(false);
    }
    router.push(`/app/biens/${propertyId}?onglet=location&lot=${unitId}`);
    router.refresh();
  };
  // Before a dossier exists nothing can be saved until someone is named.
  const canSaveLater = leaseId !== null || nameOk;

  const slide = (dir: 1 | -1) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
      : {
          initial: { opacity: 0, x: 32 * dir },
          animate: { opacity: 1, x: 0 },
          exit: { opacity: 0, x: -32 * dir },
          transition: { type: "spring" as const, stiffness: 340, damping: 34 },
        };

  const titles: Record<RentalStep, string> = {
    tenant: d.location.titleTenant,
    lease: d.location.titleLease,
    rent: d.location.titleRent,
    payment: d.location.titlePayer,
    guarantee: d.location.titleGuarantee,
    inspection: d.location.titleInspection,
    insurance: d.location.titleInsurance,
    documents: d.location.titleReview,
    activation: d.location.titleActivation,
  };

  // What an owner has actually told Morada about this tenancy. The percentage
  // is a count of real facts, not a progress bar for its own sake: each one
  // is something the product will otherwise have to ask for later.
  const checklist = [
    { label: d.location.checkTenant, done: nameOk },
    { label: d.location.checkLease, done: startDate !== "" },
    { label: d.location.checkRent, done: rentOk },
    { label: d.location.checkPayer, done: payerIban.trim() !== "" },
    { label: d.location.checkGuarantee, done: !hasDeposit || depositMonths !== "" },
    { label: d.location.checkInspection, done: edlDone },
    { label: d.location.checkInsurance, done: insuranceDone },
    { label: d.location.checkDocuments, done: false },
  ];
  const completion = Math.round((checklist.filter((c) => c.done).length / checklist.length) * 100);
  const missing: Array<{ step: RentalStep; label: string }> = [
    ...(nameOk ? [] : [{ step: "tenant" as const, label: d.location.titleTenant }]),
    ...(rentOk ? [] : [{ step: "rent" as const, label: d.location.titleRent }]),
  ];
  const ready = missing.length === 0;

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const Heading = (
    <>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-balance text-center font-display text-2xl font-bold tracking-tight text-ink outline-none sm:text-3xl"
      >
        {titles[step]}
      </h1>
      <p className="mt-2 text-center text-sm text-ink-soft">
        {unitLabel} · {propertyName}
      </p>
    </>
  );

  // The same three moves on every step: back, save and continue later, next.
  // Next is a plain button; a form's submit (the Enter key) calls the same
  // move, so a click never saves twice.
  const footer = (moves: { onNext?: () => void; nextLabel?: string; canNext?: boolean } = {}) => (
    <WizardFooter
      d={d}
      backHref={isFirstStep(step) ? `/app/biens/${propertyId}` : null}
      onBack={back}
      busy={busy}
      leaving={leaving}
      canSaveLater={canSaveLater}
      onSaveLater={() => void saveAndLeave()}
      onNext={moves.onNext}
      nextLabel={moves.nextLabel}
      canNext={moves.canNext}
    />
  );

  const errorLine = saveError && (
    <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
      {saveError}
    </p>
  );

  const overlay = (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-sand-50">
      <div className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-sand-100 bg-white/90 px-4 backdrop-blur sm:px-6">
        {isFirstStep(step) ? (
          <Link
            href={`/app/biens/${propertyId}`}
            className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink"
          >
            <BackIcon />
            {d.location.backToProperty}
          </Link>
        ) : (
          <button onClick={() => back()} className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink">
            <BackIcon />
            {d.common.back}
          </button>
        )}
        {/* The indicator reads its position from the same list the body
            renders from, so it cannot drift from what is on screen. */}
        <p className="absolute left-1/2 hidden -translate-x-1/2 text-sm text-ink-soft sm:block">
          {d.biens.wizStepOf.replace("{n}", String(stepNumber(step))).replace("{total}", String(RENTAL_TOTAL))}
        </p>
      </div>

      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
        <AnimatePresence mode="wait" initial={false}>
          {step === "tenant" && (
            <motion.div key="t1" {...slide(-1)}>
              {Heading}
              <form
                className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (nameOk) void advance();
                }}
              >
                <div className="space-y-5">
                  {people.map((person, i) => (
                    <fieldset key={i} className={i > 0 ? "border-t border-sand-100 pt-5" : ""}>
                      {people.length > 1 && (
                        <div className="mb-3 flex items-center justify-between">
                          <legend className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                            {d.location.personN.replace("{n}", String(i + 1))}
                          </legend>
                          <button
                            type="button"
                            onClick={() => removePerson(i)}
                            className="text-xs font-semibold text-ink-soft hover:text-red-700"
                          >
                            {d.location.removePerson}
                          </button>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                        <Field label={d.location.firstName}>
                          <Input
                            required={i === 0}
                            maxLength={80}
                            value={person.firstName}
                            onChange={(e) => setPerson(i, { firstName: e.target.value })}
                          />
                        </Field>
                        <Field label={d.location.lastName}>
                          <Input maxLength={80} value={person.lastName} onChange={(e) => setPerson(i, { lastName: e.target.value })} />
                        </Field>
                        <div className="col-span-2">
                          <Field label={d.location.email}>
                            <Input
                              type="email"
                              maxLength={160}
                              value={person.email}
                              onChange={(e) => setPerson(i, { email: e.target.value })}
                            />
                          </Field>
                        </div>
                        <div className="col-span-2">
                          <Field label={d.location.phone}>
                            <Input type="tel" maxLength={40} value={person.phone} onChange={(e) => setPerson(i, { phone: e.target.value })} />
                          </Field>
                        </div>
                      </div>
                    </fieldset>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setPeople((list) => [...list, blankPerson()])}
                  className="tactile mt-4 inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-dashed border-sand-300 px-3.5 py-1.5 text-sm font-semibold text-ink-soft transition hover:border-brand-300 hover:text-brand-700"
                >
                  <Icon name="plus" size={15} />
                  {d.location.addPerson}
                </button>

                {people.length > 1 && (
                  <div className="mt-4 rounded-xl bg-sand-50 p-3.5">
                    <p className="text-xs leading-relaxed text-ink-soft">{d.location.severalHint}</p>
                    <label className="mt-3 flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={colocation}
                        onChange={(e) => setColocation(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-sand-300 text-brand-600 focus:ring-brand-400"
                      />
                      <span className="text-sm text-ink">{d.location.colocationToggle}</span>
                    </label>
                    <p className="mt-2 text-xs leading-relaxed text-ink-soft">{d.location.colocationHint}</p>
                  </div>
                )}
                {errorLine}
                {footer({ onNext: () => void advance(), canNext: nameOk })}
              </form>
            </motion.div>
          )}

          {step === "lease" && (
            <motion.div key="t2" {...slide(1)}>
              {Heading}
              <form
                className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  void advance();
                }}
              >
                <Field label={d.location.leaseType}>
                  <Select value={type} onChange={(e) => setType(e.target.value as "residential" | "commercial")}>
                    <option value="residential">{d.status.leaseType.residential}</option>
                    <option value="commercial">{d.status.leaseType.commercial}</option>
                  </Select>
                </Field>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label={d.location.startDate}>
                    <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </Field>
                  <Field label={d.location.endDate} hint={d.location.endDateHint}>
                    <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                  </Field>
                </div>
                {errorLine}
                {footer({ onNext: () => void advance() })}
              </form>
            </motion.div>
          )}

          {step === "rent" && (
            <motion.div key="t3" {...slide(1)}>
              {Heading}
              <form
                className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (rentOk) void advance();
                }}
              >
                <div className="grid grid-cols-2 gap-3">
                  <Field label={d.location.rent}>
                    <Input required inputMode="decimal" value={rent} onChange={(e) => setRent(e.target.value)} className="text-right tabular-nums" />
                  </Field>
                  <Field label={d.location.charges}>
                    <Input inputMode="decimal" value={charges} onChange={(e) => setCharges(e.target.value)} className="text-right tabular-nums" />
                  </Field>
                </div>
                {totalPreview && (
                  <p className="mt-3 rounded-xl bg-sand-50 px-3.5 py-3 text-sm text-ink-soft">
                    {d.location.totalPreview}{" "}
                    <span className="font-display text-base font-bold tabular-nums text-ink">{totalPreview} €</span>
                  </p>
                )}
                <div className="mt-3">
                  <Field label={d.location.paymentDay}>
                    <Select value={paymentDay} onChange={(e) => setPaymentDay(e.target.value)}>
                      {Array.from({ length: 28 }, (_, i) => String(i + 1)).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-ink-soft">{d.location.rentHint}</p>
                {errorLine}
                {footer({ onNext: () => void advance(), canNext: rentOk })}
              </form>
            </motion.div>
          )}

          {step === "payment" && (
            <motion.div key="t4" {...slide(1)}>
              {Heading}
              <form
                className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  void advance();
                }}
              >
                <p className="text-sm leading-relaxed text-ink-soft">{d.location.payerHint}</p>
                <div className="mt-4 space-y-3">
                  <Field label={d.location.payerName}>
                    <Input maxLength={120} value={payerName} onChange={(e) => setPayerName(e.target.value)} />
                  </Field>
                  <Field label={d.location.payerIban} hint={d.location.payerIbanHint}>
                    <Input
                      maxLength={40}
                      placeholder="LU28 0019 4006 4475 0000"
                      value={payerIban}
                      onChange={(e) => setPayerIban(e.target.value)}
                      className="font-mono tabular-nums"
                    />
                  </Field>
                </div>
                {errorLine}
                {footer({ onNext: () => void advance() })}
              </form>
            </motion.div>
          )}

          {step === "guarantee" && (
            <motion.div key="t5" {...slide(1)}>
              {Heading}
              <form
                className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  void advance();
                }}
              >
                <fieldset>
                  <legend className="text-sm font-semibold text-ink">{d.location.guaranteeQuestion}</legend>
                  <div className="mt-3 flex gap-2">
                    {[true, false].map((v) => (
                      <button
                        key={String(v)}
                        type="button"
                        onClick={() => setHasDeposit(v)}
                        aria-pressed={hasDeposit === v}
                        className={
                          "tactile rounded-xl border px-4 py-2 text-sm font-semibold transition " +
                          (hasDeposit === v
                            ? "border-brand-300 bg-brand-600 text-white"
                            : "border-sand-200 bg-white text-ink-soft hover:border-brand-200")
                        }
                      >
                        {v ? d.common.yes : d.common.no}
                      </button>
                    ))}
                  </div>
                </fieldset>

                {hasDeposit && (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <Field
                      label={d.location.depositMonths}
                      hint={d.location.depositMax.replace("{n}", String(depositMax[type]))}
                    >
                      <Select value={depositMonths} onChange={(e) => setDepositMonths(e.target.value)}>
                        {["1", "2", "3"].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={d.location.depositForm}>
                      <Select value={depositForm} onChange={(e) => setDepositForm(e.target.value)}>
                        {(["cash", "bank_guarantee", "third_party_caution", "insurance", "state_guarantee"] as const).map(
                          (f) => (
                            <option key={f} value={f}>
                              {d.status.depositForm[f]}
                            </option>
                          ),
                        )}
                      </Select>
                    </Field>
                  </div>
                )}
                <p className="mt-3 text-xs leading-relaxed text-ink-soft">{d.location.guaranteeHint}</p>
                {errorLine}
                {footer({ onNext: () => void advance() })}
              </form>
            </motion.div>
          )}

          {step === "inspection" && (
            <motion.div key="t6" {...slide(1)}>
              {Heading}
              <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm">
                <p className="text-sm leading-relaxed text-ink-soft">{d.location.inspectionHint}</p>
                {real ? (
                  <Button
                    className="mt-4"
                    loading={saving}
                    onClick={async () => {
                      // The dossier is saved before leaving for the inventory,
                      // which is a journey of its own and hands back here.
                      const id = await save(step);
                      if (!id) return;
                      setEdlDone(true);
                      router.push(
                        `/app/biens/etat-des-lieux?bail=${id}&type=entry&retour=${encodeURIComponent(
                          `/app/biens/locataire?bail=${id}&etape=${stepNumber(nextStep(step))}`,
                        )}`,
                      );
                    }}
                  >
                    <Icon name="plus" size={15} />
                    {d.location.inspectionStart}
                  </Button>
                ) : (
                  <p className="mt-4 text-sm text-ink-soft">{notice}</p>
                )}
                {edlDone && <p className="mt-3 text-sm font-semibold text-emerald-700">{d.location.checkInspection}</p>}
                {errorLine}
                {footer({ onNext: () => void advance() })}
              </div>
            </motion.div>
          )}

          {step === "insurance" && (
            <motion.div key="t7" {...slide(1)}>
              {Heading}
              <form
                className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  void advanceInsurance();
                }}
              >
                <p className="text-sm leading-relaxed text-ink-soft">{d.location.insuranceHint}</p>
                <div className="mt-4 space-y-3">
                  <Field label={d.assurances.fieldProvider}>
                    <Input maxLength={120} value={insurer} onChange={(e) => setInsurer(e.target.value)} />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={d.assurances.fieldNumber}>
                      <Input maxLength={80} value={insurancePolicy} onChange={(e) => setInsurancePolicy(e.target.value)} />
                    </Field>
                    <Field label={d.assurances.fieldExpires}>
                      <Input type="date" value={insuranceExpires} onChange={(e) => setInsuranceExpires(e.target.value)} />
                    </Field>
                  </div>
                </div>
                {insuranceDone && <p className="mt-3 text-sm font-semibold text-emerald-700">{d.location.checkInsurance}</p>}
                {errorLine}
                {footer({ onNext: () => void advanceInsurance() })}
              </form>
            </motion.div>
          )}

          {step === "documents" && (
            <motion.div key="t8" {...slide(1)}>
              {Heading}
              <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-display text-lg font-bold text-ink">
                    {d.location.dossierComplete.replace("{pct}", String(completion))}
                  </p>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sand-200" aria-hidden>
                  <span className="block h-full rounded-full bg-brand-600" style={{ width: `${completion}%` }} />
                </div>

                <ul className="mt-4 space-y-1.5">
                  {checklist.map((c) => (
                    <li key={c.label} className="flex items-center gap-2.5 text-sm">
                      <span className={c.done ? "text-emerald-600" : "text-sand-400"}>
                        <Icon name={c.done ? "check" : "clock"} size={15} />
                      </span>
                      <span className={c.done ? "text-ink" : "text-ink-soft"}>{c.label}</span>
                    </li>
                  ))}
                </ul>

                {compliance.length > 0 && (
                  <div className="mt-5 rounded-xl border border-sand-200 bg-sand-50 p-3.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.location.complianceTitle}</p>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-ink">
                      {compliance.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                    <p className="mt-2.5 text-xs leading-relaxed text-ink-soft">{d.location.complianceNote}</p>
                  </div>
                )}

                <p className="mt-4 text-xs leading-relaxed text-ink-soft">{d.location.documentsNote}</p>
                {errorLine}
                {footer({ onNext: () => void advance() })}
              </div>
            </motion.div>
          )}

          {step === "activation" && (
            <motion.div key="t9" {...slide(1)}>
              {Heading}
              <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm">
                <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.location.checkTenant}</dt>
                    <dd className="mt-0.5 text-sm font-semibold text-ink">
                      {named.length > 0 ? named.map((p) => `${p.firstName} ${p.lastName}`.trim()).join(", ") : d.common.none}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.location.totalPreview}</dt>
                    <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{totalPreview ? `${totalPreview} €` : d.common.none}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.location.startDate}</dt>
                    <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{startDate || d.common.none}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.location.paymentDay}</dt>
                    <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{paymentDay}</dd>
                  </div>
                </dl>

                <p className="mt-5 text-sm leading-relaxed text-ink-soft">{d.location.activationHint}</p>

                {!ready && (
                  <div role="status" className="mt-4 rounded-xl bg-amber-50 px-4 py-3">
                    <p className="text-sm font-semibold text-amber-900">{d.location.activationMissing}</p>
                    <ul className="mt-1.5 space-y-1">
                      {missing.map((m) => (
                        <li key={m.step}>
                          <button
                            type="button"
                            onClick={() => {
                              setStep(m.step);
                              syncUrl(leaseId, m.step);
                            }}
                            className="text-sm font-semibold text-brand-700 hover:underline"
                          >
                            {m.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {activateError && (
                  <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                    {activateError}
                  </p>
                )}
                {errorLine}

                {real ? (
                  footer({ onNext: () => void activate(), nextLabel: d.location.activate, canNext: ready })
                ) : (
                  <>
                    <p role="status" className="mt-6 rounded-xl bg-emerald-50 px-4 py-3 text-center text-sm font-semibold text-emerald-800">
                      {notice}
                    </p>
                    {footer()}
                  </>
                )}
                <p className="sr-only" aria-live="polite">
                  {activating ? d.location.activate : ""}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );

  return mounted ? createPortal(overlay, document.body) : overlay;
}

function BackIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7 7-7M3 12h18" />
    </svg>
  );
}

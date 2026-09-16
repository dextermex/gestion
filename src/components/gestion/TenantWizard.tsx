"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button, Field, Input, Select } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import type { Dict } from "@/lib/i18n/fr";
import {
  CREATION_STEP,
  RENTAL_TOTAL,
  canLeave,
  isFirstStep,
  nextStep,
  prevStep,
  shouldCreateOnLeaving,
  stepNumber,
  type RentalStep,
} from "@/lib/gestion/rental-flow";

/**
 * Putting a tenant into a lot, as a conversation.
 *
 * The owner started from the lot, so the lot is never asked for again. Eight
 * short steps collect the people, the lease, the rent, the account the rent
 * will arrive from, the guarantee, the inventory, the insurance and the
 * documents, and that is the whole configuration. There is no "start
 * tracking this rent" switch afterwards: an active lease with a rent and a
 * due day IS the monthly obligation, and the ledger opens itself the moment
 * the lease is written.
 *
 * A lease is signed by everyone who moves in. A couple, a family or three
 * roommates are each a tenant in their own right on the same lease, which is
 * why the first step is a list of people rather than a person.
 */

export type Person = { firstName: string; lastName: string; email: string; phone: string };

type LeaseStatus = "draft" | "active" | "notice" | "ended";

const blankPerson = (): Person => ({ firstName: "", lastName: "", email: "", phone: "" });
const hasName = (p: Person): boolean => p.firstName.trim() !== "" || p.lastName.trim() !== "";

type Props = {
  d: Dict;
  unitLabel: string;
  propertyName: string;
  propertyId: string;
  unitId: string;
  /** Real account: the flow writes tenants, lease, ledger, deposit and payer. */
  real: boolean;
  notice: string;
  /** What the law allows for the guarantee, by lease type, resolved by the
   *  parameter registry on the server so the step can say it. */
  depositMax: { residential: number; commercial: number };
  /** Resuming a rental that already exists: its id, and what is already
   *  known about it, so the earlier steps open filled in rather than blank. */
  existing?: {
    leaseId: string;
    status: LeaseStatus;
    startStep: RentalStep;
    tenants: Person[];
    colocation: boolean;
    type: "residential" | "commercial";
    startDate: string;
    endDate: string;
    rent: string;
    charges: string;
    paymentDay: string;
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [leaseId, setLeaseId] = useState<string | null>(existing?.leaseId ?? null);
  const [leaseStatus, setLeaseStatus] = useState<LeaseStatus | null>(existing?.status ?? null);
  // What the written lease still lacks, as the legal engine said it when
  // the rental was recorded. Informative: the rental runs regardless.
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

  const [payerName, setPayerName] = useState("");
  const [payerIban, setPayerIban] = useState(existing?.payerIban ?? "");

  const [edlDone, setEdlDone] = useState(existing?.hasInspection ?? false);
  const [insurer, setInsurer] = useState("");
  const [insurancePolicy, setInsurancePolicy] = useState("");
  const [insuranceExpires, setInsuranceExpires] = useState("");
  const [insuranceDone, setInsuranceDone] = useState(existing?.hasInsurance ?? false);

  const [hasDeposit, setHasDeposit] = useState(existing ? existing.depositMonths !== "0" : true);
  const [depositMonths, setDepositMonths] = useState(existing?.depositMonths ?? "2");
  const [depositForm, setDepositForm] = useState(existing?.depositForm ?? "cash");

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const nameOk = people.some(hasName);
  const rentOk = rent.trim() !== "";
  const canSubmit = nameOk && rentOk;
  const named = people.filter(hasName);

  const setPerson = (i: number, patch: Partial<Person>) =>
    setPeople((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const removePerson = (i: number) => {
    setPeople((list) => (list.length > 1 ? list.filter((_, j) => j !== i) : list));
    if (people.length <= 2) setColocation(false);
  };

  // The live total is the whole point of this step: what the tenant will
  // actually transfer each month.
  const totalPreview = (() => {
    const toNumber = (v: string) => {
      const n = Number(v.replace(/[\s €]/g, "").replace(",", "."));
      return Number.isFinite(n) ? n : 0;
    };
    const t = toNumber(rent) + toNumber(charges);
    return t > 0 ? t.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null;
  })();

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/locations/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unitId,
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
          depositMonths: hasDeposit ? depositMonths : 0,
          depositForm,
        }),
      });
      if (res.status === 401) {
        window.location.assign(`/connexion?next=/app/biens/locataire?lot=${unitId}`);
        return;
      }
      if (res.status === 409) {
        setSaveError(d.location.alreadyLet);
        setSaving(false);
        return;
      }
      if (!res.ok) {
        setSaveError(d.location.saveFailed);
        setSaving(false);
        return;
      }
      const created = (await res.json()) as {
        leaseId: string;
        status: "active";
        issues?: Array<{ severity: string; message: string }>;
      };
      setLeaseId(created.leaseId);
      setLeaseStatus(created.status);
      setCompliance((created.issues ?? []).map((i) => i.message));
      setStep(nextStep(CREATION_STEP));
      return;
    } catch {
      setSaveError(d.location.saveFailed);
    }
    setSaving(false);
  };

  // A dossier written before lifecycle and compliance were told apart is
  // still a draft: this is its way into force, from the same review step.
  const activate = async () => {
    if (!leaseId) return;
    setActivating(true);
    setActivateError(null);
    try {
      const res = await fetch(`/api/baux/${leaseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate" }),
      });
      if (res.ok) {
        setLeaseStatus("active");
        router.refresh();
      } else {
        setActivateError(d.bien.draftActivateFailed);
      }
    } catch {
      setActivateError(d.bien.draftActivateFailed);
    }
    setActivating(false);
  };

  const filled = { tenant: nameOk, rent: rentOk };

  /**
   * Moving on. Leaving the creation step writes the rental the first time and
   * only the first time; every other step, and every later visit to this one,
   * simply advances. Nothing here inspects whether a section was filled in to
   * decide which step comes next: that is what used to lose steps.
   */
  const advance = () => {
    if (saving) return;
    if (!canLeave(step, filled)) return;
    if (shouldCreateOnLeaving(step, leaseId)) {
      if (!canSubmit) return;
      if (real) {
        void save();
        return;
      }
    }
    setStep(nextStep(step));
  };

  const back = () => {
    if (saving) return;
    setStep(prevStep(step));
  };

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
    review: d.location.titleReview,
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

  const Footer = ({ onNext, nextLabel }: { onNext: () => void; nextLabel?: string }) => (
    <div className="mt-6 flex justify-end">
      <Button type="submit" onClick={onNext}>
        {nextLabel ?? d.common.next}
      </Button>
    </div>
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
                  if (nameOk) advance();
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

                <Footer onNext={() => nameOk && advance()} />
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
                  advance();
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
                <div className="mt-6 flex items-center justify-between">
                  <button type="button" onClick={() => advance()} className="text-sm font-semibold text-ink-soft hover:text-ink">
                    {d.biens.wizLater}
                  </button>
                  <Button type="submit">{d.common.next}</Button>
                </div>
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
                  if (rentOk) advance();
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
                <Footer onNext={() => rentOk && advance()} />
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
                  advance();
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
                <div className="mt-6 flex items-center justify-between">
                  <button type="button" onClick={() => advance()} className="text-sm font-semibold text-ink-soft hover:text-ink">
                    {d.biens.wizLater}
                  </button>
                  <Button type="submit">{d.common.next}</Button>
                </div>
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
                  advance();
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

                {saveError && (
                  <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                    {saveError}
                  </p>
                )}
                <div className="mt-6 flex justify-end">
                  <Button type="submit" disabled={!canSubmit} loading={saving}>
                    {shouldCreateOnLeaving(step, leaseId) ? d.location.createRental : d.common.next}
                  </Button>
                </div>
              </form>
            </motion.div>
          )}

          {step === "inspection" && (
            <motion.div key="t6" {...slide(1)}>
              {Heading}
              <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm">
                <p className="text-sm leading-relaxed text-ink-soft">{d.location.inspectionHint}</p>
                {real && leaseId ? (
                  <Link
                    href={`/app/biens/etat-des-lieux?bail=${leaseId}&type=entry&retour=${encodeURIComponent(
                      `/app/biens/locataire?bail=${leaseId}&etape=${stepNumber(nextStep(step))}`,
                    )}`}
                    onClick={() => setEdlDone(true)}
                    className="tactile mt-4 inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                  >
                    <Icon name="plus" size={15} />
                    {d.location.inspectionStart}
                  </Link>
                ) : (
                  <p className="mt-4 text-sm text-ink-soft">{notice}</p>
                )}
                <div className="mt-6 flex items-center justify-between">
                  <button onClick={() => advance()} className="text-sm font-semibold text-ink-soft hover:text-ink">
                    {d.biens.wizLater}
                  </button>
                  <Button onClick={() => advance()}>{d.common.next}</Button>
                </div>
              </div>
            </motion.div>
          )}

          {step === "insurance" && (
            <motion.div key="t7" {...slide(1)}>
              {Heading}
              <form
                className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!real || !leaseId || insurer.trim() === "") {
                    advance();
                    return;
                  }
                  setSaving(true);
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
                  setSaving(false);
                  if (res.ok) setInsuranceDone(true);
                  advance();
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
                <div className="mt-6 flex items-center justify-between">
                  <button type="button" onClick={() => advance()} className="text-sm font-semibold text-ink-soft hover:text-ink">
                    {d.biens.wizLater}
                  </button>
                  <Button type="submit" loading={saving}>
                    {d.common.next}
                  </Button>
                </div>
              </form>
            </motion.div>
          )}

          {step === "review" && (
            <motion.div key="t8" {...slide(1)}>
              {Heading}
              <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm">
                {real && leaseId && leaseStatus === "draft" && (
                  <div role="status" className="mb-5 rounded-xl bg-amber-50 px-4 py-3.5">
                    <p className="text-sm font-semibold text-amber-900">{d.location.draftResume}</p>
                    {activateError && (
                      <p role="alert" className="mt-2 text-sm font-semibold text-red-700">
                        {activateError}
                      </p>
                    )}
                    <Button className="mt-3" size="sm" loading={activating} onClick={() => void activate()}>
                      {d.location.activate}
                    </Button>
                  </div>
                )}
                {real && leaseId && leaseStatus === "active" && existing?.status === "draft" && (
                  <p role="status" className="mb-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                    {d.location.activated}
                  </p>
                )}

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

                <p className="mt-4 text-xs leading-relaxed text-ink-soft">{d.location.reviewNote}</p>

                <div className="mt-6 flex flex-col gap-2.5">
                  {real && leaseId ? (
                    <Button onClick={() => router.push(`/app/baux/${leaseId}`)}>{d.location.openRental}</Button>
                  ) : (
                    <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-center text-sm font-semibold text-emerald-800">
                      {notice}
                    </p>
                  )}
                  <Button variant="secondary" onClick={() => router.push(`/app/biens/${propertyId}?onglet=location`)}>
                    {d.location.backToProperty}
                  </Button>
                </div>
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

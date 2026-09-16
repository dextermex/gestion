"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button, Field, Input, Select } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import type { Dict } from "@/lib/i18n/fr";

/**
 * Putting a tenant into a lot, as a conversation.
 *
 * The owner started from the lot, so the lot is never asked for again. Five
 * short steps collect the tenant, the lease, the rent, the account the rent
 * will arrive from and the guarantee — and that is the whole configuration.
 * There is no "start tracking this rent" switch afterwards: an active lease
 * with a rent and a due day IS the monthly obligation, and the ledger opens
 * itself the moment the lease is written.
 */

type Props = {
  d: Dict;
  unitLabel: string;
  propertyName: string;
  propertyId: string;
  unitId: string;
  /** Real account: the flow writes tenant, lease, ledger, deposit and payer. */
  real: boolean;
  notice: string;
};

/** Five steps create the rental; the last three enrich it once it exists,
 *  because an inspection and a policy both need a lease to belong to. */
const LAST_INPUT = 5;
const LAST_STEP = 8;

export default function TenantWizard({
  d,
  unitLabel,
  propertyName,
  propertyId,
  unitId,
  real,
  notice,
}: Props) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [leaseId, setLeaseId] = useState<string | null>(null);
  const [draftIssues, setDraftIssues] = useState<string[]>([]);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [type, setType] = useState<"residential" | "commercial">("residential");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");

  const [rent, setRent] = useState("");
  const [charges, setCharges] = useState("");
  const [paymentDay, setPaymentDay] = useState("1");

  const [payerName, setPayerName] = useState("");
  const [payerIban, setPayerIban] = useState("");

  const [edlDone, setEdlDone] = useState(false);
  const [insurer, setInsurer] = useState("");
  const [insurancePolicy, setInsurancePolicy] = useState("");
  const [insuranceExpires, setInsuranceExpires] = useState("");
  const [insuranceDone, setInsuranceDone] = useState(false);

  const [hasDeposit, setHasDeposit] = useState(true);
  const [depositMonths, setDepositMonths] = useState("2");
  const [depositForm, setDepositForm] = useState("cash");

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const nameOk = firstName.trim() !== "" || lastName.trim() !== "";
  const rentOk = rent.trim() !== "";
  const canSubmit = nameOk && rentOk;

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
          firstName,
          lastName,
          email,
          phone,
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
        status: string;
        issues?: Array<{ severity: string; message: string }>;
      };
      setLeaseId(created.leaseId);
      setDraftIssues(
        created.status === "draft"
          ? (created.issues ?? []).filter((i) => i.severity === "blocking").map((i) => i.message)
          : [],
      );
      setStep(6);
      return;
    } catch {
      setSaveError(d.location.saveFailed);
    }
    setSaving(false);
  };

  const submit = () => {
    if (!canSubmit || saving) return;
    if (real) void save();
    else setStep(6);
  };

  const go = (delta: 1 | -1) => setStep((s) => Math.min(LAST_STEP, Math.max(1, s + delta)));

  const slide = (dir: 1 | -1) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
      : {
          initial: { opacity: 0, x: 32 * dir },
          animate: { opacity: 1, x: 0 },
          exit: { opacity: 0, x: -32 * dir },
          transition: { type: "spring" as const, stiffness: 340, damping: 34 },
        };

  const titles: Record<number, string> = {
    1: d.location.titleTenant,
    2: d.location.titleLease,
    3: d.location.titleRent,
    4: d.location.titlePayer,
    5: d.location.titleGuarantee,
    6: d.location.titleInspection,
    7: d.location.titleInsurance,
    8: d.location.titleReview,
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
        {step === 1 || step > LAST_INPUT ? (
          <Link
            href={`/app/biens/${propertyId}`}
            className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink"
          >
            <BackIcon />
            {d.location.backToProperty}
          </Link>
        ) : (
          <button onClick={() => go(-1)} className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink">
            <BackIcon />
            {d.common.back}
          </button>
        )}
        {step <= LAST_STEP && (
          <p className="absolute left-1/2 hidden -translate-x-1/2 text-sm text-ink-soft sm:block">
            {d.biens.wizStepOf.replace("{n}", String(step)).replace("{total}", String(LAST_STEP))}
          </p>
        )}
      </div>

      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
        <AnimatePresence mode="wait" initial={false}>
          {step === 1 && (
            <motion.div key="t1" {...slide(-1)}>
              {Heading}
              <form
                className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (nameOk) go(1);
                }}
              >
                <div className="grid grid-cols-2 gap-3">
                  <Field label={d.location.firstName}>
                    <Input required maxLength={80} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                  </Field>
                  <Field label={d.location.lastName}>
                    <Input maxLength={80} value={lastName} onChange={(e) => setLastName(e.target.value)} />
                  </Field>
                  <div className="col-span-2">
                    <Field label={d.location.email}>
                      <Input type="email" maxLength={160} value={email} onChange={(e) => setEmail(e.target.value)} />
                    </Field>
                  </div>
                  <div className="col-span-2">
                    <Field label={d.location.phone}>
                      <Input type="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
                    </Field>
                  </div>
                </div>
                <Footer onNext={() => nameOk && go(1)} />
              </form>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="t2" {...slide(1)}>
              {Heading}
              <form
                className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  go(1);
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
                <Footer onNext={() => go(1)} />
              </form>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div key="t3" {...slide(1)}>
              {Heading}
              <form
                className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (rentOk) go(1);
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
                <Footer onNext={() => rentOk && go(1)} />
              </form>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div key="t4" {...slide(1)}>
              {Heading}
              <form
                className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  go(1);
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
                  <button type="button" onClick={() => go(1)} className="text-sm font-semibold text-ink-soft hover:text-ink">
                    {d.biens.wizLater}
                  </button>
                  <Button type="submit">{d.common.next}</Button>
                </div>
              </form>
            </motion.div>
          )}

          {step === 5 && (
            <motion.div key="t5" {...slide(1)}>
              {Heading}
              <form
                className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
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
                    <Field label={d.location.depositMonths}>
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
                    {d.location.createRental}
                  </Button>
                </div>
              </form>
            </motion.div>
          )}

          {step === 6 && (
            <motion.div key="t6" {...slide(1)}>
              {Heading}
              <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm">
                {draftIssues.length > 0 && (
                  <div role="status" className="mb-4 rounded-xl bg-amber-50 px-4 py-3">
                    <p className="text-sm font-semibold text-amber-900">{d.location.draftTitle}</p>
                    <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-amber-900">
                      {draftIssues.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-sm leading-relaxed text-ink-soft">{d.location.inspectionHint}</p>
                {real && leaseId ? (
                  <Link
                    href={`/app/biens/etat-des-lieux?bail=${leaseId}&type=entry`}
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
                  <button onClick={() => setStep(7)} className="text-sm font-semibold text-ink-soft hover:text-ink">
                    {d.biens.wizLater}
                  </button>
                  <Button onClick={() => setStep(7)}>{d.common.next}</Button>
                </div>
              </div>
            </motion.div>
          )}

          {step === 7 && (
            <motion.div key="t7" {...slide(1)}>
              {Heading}
              <form
                className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!real || !leaseId || insurer.trim() === "") {
                    setStep(8);
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
                  setStep(8);
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
                  <button type="button" onClick={() => setStep(8)} className="text-sm font-semibold text-ink-soft hover:text-ink">
                    {d.biens.wizLater}
                  </button>
                  <Button type="submit" loading={saving}>
                    {d.common.next}
                  </Button>
                </div>
              </form>
            </motion.div>
          )}

          {step === 8 && (
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

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button, Field, Input, Select } from "@/components/pro/ui";
import type { Dict } from "@/lib/i18n/fr";
import { fmt } from "@/lib/i18n/config";

/**
 * The tenant's account-creation journey, opened from the invitation link:
 * identity and ID document (KYC), contact details with email confirmation,
 * then address. Three steps that slide along one axis; reduced motion
 * crossfades. Demo build: the final step shows the created space.
 */

export default function TenantOnboarding({
  d,
  orgName,
  unitLabel,
}: {
  d: Dict;
  orgName: string;
  unitLabel: string;
}) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [step, setStep] = useState(1);
  const [done, setDone] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [docNo, setDocNo] = useState("");
  const [email, setEmail] = useState("");
  const [email2, setEmail2] = useState("");
  const [mobile, setMobile] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");

  useEffect(() => {
    headingRef.current?.focus();
  }, [step, done]);

  const emailMismatch = email2.length > 0 && email !== email2;
  const ok1 = first.trim() !== "" && last.trim() !== "" && docNo.trim() !== "";
  const ok2 = email.trim() !== "" && email === email2 && mobile.trim() !== "";
  const ok3 = street.trim() !== "" && city.trim() !== "";

  const slide = (dir: 1 | -1) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
      : {
          initial: { opacity: 0, x: 32 * dir },
          animate: { opacity: 1, x: 0 },
          exit: { opacity: 0, x: -32 * dir },
          transition: { type: "spring" as const, stiffness: 340, damping: 34 },
        };

  const stepLabel = step === 1 ? d.tenant.obStep1 : step === 2 ? d.tenant.obStep2 : d.tenant.obStep3;

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-sand-50">
      <div className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-sand-100 bg-white/90 px-4 backdrop-blur sm:px-6">
        {step > 1 && !done ? (
          <button
            onClick={() => setStep((s) => s - 1)}
            className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7 7-7M3 12h18" />
            </svg>
            {d.tenant.obBack}
          </button>
        ) : (
          <span className="font-display text-sm font-bold text-brand-800">Morada Gestion</span>
        )}
        {!done && (
          <p className="absolute left-1/2 hidden -translate-x-1/2 text-sm text-ink-soft sm:block">{stepLabel}</p>
        )}
        <div className="flex-1" />
        {/* Step dots */}
        {!done && (
          <div className="flex items-center gap-1.5" aria-hidden>
            {[1, 2, 3].map((i) => (
              <span
                key={i}
                className={
                  "h-1.5 rounded-full transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] " +
                  (i === step ? "w-6 bg-brand-600" : i < step ? "w-1.5 bg-brand-300" : "w-1.5 bg-sand-200")
                }
              />
            ))}
          </div>
        )}
      </div>

      <div className="mx-auto w-full max-w-xl px-4 py-10 sm:px-6">
        {!done && step === 1 && (
          <p className="mb-6 rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3 text-sm text-ink">
            {fmt(d.tenant.obIntro, { org: orgName, unit: unitLabel })}
          </p>
        )}

        <AnimatePresence mode="wait" initial={false}>
          {done ? (
            <motion.div key="done" {...slide(1)} className="text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="h-7 w-7" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
                </svg>
              </span>
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="mt-5 font-display text-2xl font-bold tracking-tight text-ink outline-none"
              >
                {fmt(d.tenant.obDoneTitle, { name: first || last })}
              </h1>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-soft">{d.tenant.obDoneBody}</p>
              <Button className="mt-6" onClick={() => router.push("/locataire")}>
                {d.tenant.obGo}
              </Button>
            </motion.div>
          ) : (
            <motion.div key={step} {...slide(1)}>
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="text-balance font-display text-2xl font-bold tracking-tight text-ink outline-none"
              >
                {d.tenant.obTitle}
              </h1>
              <form
                className="mt-6 space-y-4 rounded-2xl border border-sand-200 bg-white p-6 shadow-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (step === 1 && ok1) setStep(2);
                  else if (step === 2 && ok2) setStep(3);
                  else if (step === 3 && ok3) setDone(true);
                }}
              >
                {step === 1 && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={d.tenant.obFirst}>
                        <Input required autoComplete="given-name" maxLength={60} value={first} onChange={(e) => setFirst(e.target.value)} />
                      </Field>
                      <Field label={d.tenant.obLast}>
                        <Input required autoComplete="family-name" maxLength={60} value={last} onChange={(e) => setLast(e.target.value)} />
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={d.tenant.obDocType}>
                        <Select defaultValue="id">
                          <option value="id">{d.tenant.obDocId}</option>
                          <option value="passport">{d.tenant.obDocPassport}</option>
                        </Select>
                      </Field>
                      <Field label={d.tenant.obDocNumber} hint={d.tenant.obDocHint}>
                        <Input required maxLength={30} value={docNo} onChange={(e) => setDocNo(e.target.value)} />
                      </Field>
                    </div>
                  </>
                )}

                {step === 2 && (
                  <>
                    <Field label={d.tenant.obEmail}>
                      <Input type="email" required autoComplete="email" maxLength={120} value={email} onChange={(e) => setEmail(e.target.value)} />
                    </Field>
                    <Field label={d.tenant.obEmailConfirm}>
                      <Input
                        type="email"
                        required
                        maxLength={120}
                        value={email2}
                        onChange={(e) => setEmail2(e.target.value)}
                        aria-invalid={emailMismatch || undefined}
                        className={emailMismatch ? "border-red-300 focus:border-red-400 focus:ring-red-100" : undefined}
                      />
                    </Field>
                    {emailMismatch && (
                      <p role="alert" className="text-xs font-semibold text-red-700">
                        {d.tenant.obEmailMismatch}
                      </p>
                    )}
                    <Field label={d.tenant.obMobile}>
                      <Input type="tel" required autoComplete="tel" inputMode="tel" maxLength={30} placeholder="+352 621 …" value={mobile} onChange={(e) => setMobile(e.target.value)} />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={d.tenant.obFix}>
                        <Input type="tel" inputMode="tel" maxLength={30} />
                      </Field>
                      <Field label={d.tenant.obOther}>
                        <Input maxLength={60} />
                      </Field>
                    </div>
                  </>
                )}

                {step === 3 && (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <Field label={d.tenant.obStreet}>
                        <Input required autoComplete="address-line1" maxLength={160} value={street} onChange={(e) => setStreet(e.target.value)} />
                      </Field>
                    </div>
                    <Field label={d.tenant.obNumber}>
                      <Input maxLength={10} inputMode="numeric" />
                    </Field>
                    <Field label={d.tenant.obPostal}>
                      <Input maxLength={10} autoComplete="postal-code" inputMode="numeric" placeholder="L-" />
                    </Field>
                    <div className="col-span-2">
                      <Field label={d.tenant.obCity}>
                        <Input required autoComplete="address-level2" maxLength={80} value={city} onChange={(e) => setCity(e.target.value)} />
                      </Field>
                    </div>
                    <div className="col-span-3">
                      <Field label={d.tenant.obCountry}>
                        <Select defaultValue="LU">
                          <option value="LU">Luxembourg</option>
                          <option value="FR">France</option>
                          <option value="BE">Belgique</option>
                          <option value="DE">Deutschland</option>
                        </Select>
                      </Field>
                    </div>
                  </div>
                )}

                <div className="flex justify-end pt-1">
                  <Button type="submit" disabled={step === 1 ? !ok1 : step === 2 ? !ok2 : !ok3}>
                    {step === 3 ? d.tenant.obCreate : d.tenant.obNext}
                  </Button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

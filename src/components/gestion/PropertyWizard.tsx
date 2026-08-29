"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button, Field, Input, Select } from "@/components/pro/ui";
import type { Dict } from "@/lib/i18n/fr";

/**
 * Full-screen two-step "add property" flow (the immocloud wizard, in Morada's
 * language): 1) pick the property type from three cards, 2) key data +
 * address. Demo build — submitting shows the standard demo notice instead of
 * persisting. Steps slide along one axis and reverse along the same path;
 * reduced motion collapses to a crossfade.
 */

type PropertyType = "building" | "units" | "house";

const TYPE_ICONS: Record<PropertyType, React.ReactNode> = {
  building: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-8 w-8" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M5 21V5.5A1.5 1.5 0 0 1 6.5 4h6A1.5 1.5 0 0 1 14 5.5V21M14 9h4.5A1.5 1.5 0 0 1 20 10.5V21M8 8h3M8 12h3M8 16h3M17 13h.01M17 17h.01" />
    </svg>
  ),
  units: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-8 w-8" aria-hidden>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path strokeLinecap="round" d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M12 18v3" />
    </svg>
  ),
  house: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-8 w-8" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="m3 11 9-7 9 7M5.5 9.5V21h13V9.5M10 21v-5.5h4V21" />
    </svg>
  ),
};

export default function PropertyWizard({
  d,
  notice,
  noticeTone = "demo",
}: {
  d: Dict;
  /** End-screen message: the demo notice on sample cabinets, the honest
   *  "not stored yet" note on real accounts. */
  notice: string;
  noticeTone?: "demo" | "pending";
}) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [type, setType] = useState<PropertyType | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [name, setName] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);

  const step = type === null ? 1 : 2;
  const canCreate = name.trim().length > 0 && street.trim().length > 0 && city.trim().length > 0;

  // Move focus to the step heading on transitions — the wizard is a journey,
  // the screen reader should travel with it.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step, submitted]);

  const slide = (dir: 1 | -1) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
      : {
          initial: { opacity: 0, x: 32 * dir },
          animate: { opacity: 1, x: 0 },
          exit: { opacity: 0, x: -32 * dir },
          transition: { type: "spring" as const, stiffness: 340, damping: 34 },
        };

  const types: Array<{ id: PropertyType; title: string; body: string }> = [
    { id: "building", title: d.biens.wizTypeBuilding, body: d.biens.wizTypeBuildingBody },
    { id: "units", title: d.biens.wizTypeUnits, body: d.biens.wizTypeUnitsBody },
    { id: "house", title: d.biens.wizTypeHouse, body: d.biens.wizTypeHouseBody },
  ];

  // The route template animates its wrapper (opacity), which would trap this
  // fixed overlay in that stacking context, under the shell chrome. After
  // mount the overlay escapes to <body>; the SSR frame renders inline so
  // hydration matches, invisible behind the entrance fade.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const overlay = (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-sand-50">
      {/* Top bar */}
      <div className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-sand-100 bg-white/90 px-4 backdrop-blur sm:px-6">
        {step === 1 || submitted ? (
          <Link
            href="/app/biens"
            className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink"
          >
            <BackIcon />
            {d.biens.wizBack}
          </Link>
        ) : (
          <button
            onClick={() => setType(null)}
            className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink"
          >
            <BackIcon />
            {d.biens.wizBackToType}
          </button>
        )}
        <p className="absolute left-1/2 hidden -translate-x-1/2 text-sm text-ink-soft sm:block">
          {step === 1 ? d.biens.wizStep1 : d.biens.wizStep2}
        </p>
        <div className="flex-1" />
        {step === 2 && !submitted && (
          <Button type="submit" form="property-wizard-form" disabled={!canCreate}>
            {d.biens.wizCreate}
          </Button>
        )}
      </div>

      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
        <AnimatePresence mode="wait" initial={false}>
          {submitted ? (
            <motion.div key="done" {...slide(1)} className="mx-auto max-w-xl text-center">
              <span
                className={
                  "mx-auto flex h-14 w-14 items-center justify-center rounded-full " +
                  (noticeTone === "demo" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")
                }
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="h-7 w-7" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
                </svg>
              </span>
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="mt-5 font-display text-2xl font-bold tracking-tight text-ink outline-none"
              >
                {name || d.biens.wizTypeHouse}
              </h1>
              <p
                role="status"
                className={
                  "mt-3 rounded-xl px-4 py-3 text-sm font-semibold " +
                  (noticeTone === "demo" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900")
                }
              >
                {notice}
              </p>
              <Button className="mt-6" onClick={() => router.push("/app/biens")}>
                {d.biens.wizBack}
              </Button>
            </motion.div>
          ) : step === 1 ? (
            <motion.div key="step1" {...slide(-1)}>
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="text-balance text-center font-display text-2xl font-bold tracking-tight text-ink outline-none sm:text-3xl"
              >
                {d.biens.wizTitle1}
              </h1>
              <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
                {types.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setType(t.id)}
                    className="tactile group flex flex-col items-center rounded-2xl border border-sand-200 bg-white p-6 text-center shadow-sm transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md motion-reduce:hover:translate-y-0"
                  >
                    <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
                      {TYPE_ICONS[t.id]}
                    </span>
                    <span className="mt-4 font-display text-base font-bold text-ink">{t.title}</span>
                    <span className="mt-1.5 text-sm leading-relaxed text-ink-soft">{t.body}</span>
                    <span className="mt-5 inline-flex w-full items-center justify-center rounded-xl border border-sand-200 py-2 text-sm font-semibold text-ink-soft transition group-hover:border-brand-300 group-hover:bg-brand-600 group-hover:text-white">
                      {d.biens.wizChoose}
                    </span>
                  </button>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div key="step2" {...slide(1)}>
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="text-balance text-center font-display text-2xl font-bold tracking-tight text-ink outline-none sm:text-3xl"
              >
                {d.biens.wizTitle2}
              </h1>
              <form
                id="property-wizard-form"
                className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canCreate) setSubmitted(true);
                }}
              >
                <h2 className="font-display text-lg font-bold text-ink">{d.biens.wizKeyData}</h2>
                <div className="mt-3">
                  <Field label={d.biens.wizNameLabel} hint={d.biens.wizNameHint}>
                    <Input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
                  </Field>
                </div>

                <h2 className="mt-6 font-display text-lg font-bold text-ink">{d.biens.wizAddress}</h2>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <Field label={d.biens.wizStreet}>
                      <Input required maxLength={160} value={street} onChange={(e) => setStreet(e.target.value)} />
                    </Field>
                  </div>
                  <Field label={d.biens.wizNumber}>
                    <Input maxLength={10} inputMode="numeric" />
                  </Field>
                  <Field label={d.biens.wizPostal}>
                    <Input maxLength={10} inputMode="numeric" placeholder="L-" />
                  </Field>
                  <div className="col-span-2">
                    <Field label={d.biens.wizCity}>
                      <Input required maxLength={80} value={city} onChange={(e) => setCity(e.target.value)} />
                    </Field>
                  </div>
                  <div className="col-span-3">
                    <Field label={d.biens.wizCountry}>
                      <Select defaultValue="LU">
                        <option value="LU">Luxembourg</option>
                        <option value="FR">France</option>
                        <option value="BE">Belgique</option>
                        <option value="DE">Deutschland</option>
                      </Select>
                    </Field>
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <Button type="submit" disabled={!canCreate}>
                    {d.biens.wizCreate}
                  </Button>
                </div>
              </form>
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

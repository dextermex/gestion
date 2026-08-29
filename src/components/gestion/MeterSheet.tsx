"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button, Field, Input, Select, Textarea } from "@/components/pro/ui";
import { METER_UNITS } from "@/lib/types";
import type { MeterKind } from "@/lib/types";
import type { Dict } from "@/lib/i18n/fr";

/**
 * "Create meter" as a right-hand sheet (the immocloud pattern): general
 * information block, unit auto-derived from the meter type, sub-meter toggle.
 * On a real account submit persists through /api/compteurs/create; the
 * sample cabinets keep the explicitly-fake notice. Enters from the right and
 * leaves the same way; reduced motion crossfades.
 */

const KINDS: MeterKind[] = ["electricity", "gas", "water_cold", "water_hot", "heat"];

export default function MeterCreate({
  d,
  options,
  real,
}: {
  d: Dict;
  options: Array<{ id: string; label: string }>;
  real?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path strokeLinecap="round" d="M12 5v14M5 12h14" />
        </svg>
        {d.compteurs.addMeter}
      </Button>
      <MeterSheet d={d} options={options} real={real} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function MeterSheet({
  d,
  options,
  real,
  open,
  onClose,
}: {
  d: Dict;
  options: Array<{ id: string; label: string }>;
  real?: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const reduced = useReducedMotion();
  const router = useRouter();
  const [kind, setKind] = useState<MeterKind>("electricity");
  const [secondary, setSecondary] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const submitReal = async (form: HTMLFormElement) => {
    const f = new FormData(form);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/compteurs/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: String(f.get("target") ?? ""),
          serial: String(f.get("serial") ?? ""),
          supplier: String(f.get("supplier") ?? ""),
          kind,
        }),
      });
      if (!res.ok) {
        setError(d.shell.createFailed);
        setSaving(false);
        return;
      }
      onClose();
      router.refresh();
    } catch {
      setError(d.shell.createFailed);
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setSubmitted(false);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    document.documentElement.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = "";
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60]">
          <motion.div
            className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onPointerDown={onClose}
            aria-hidden
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal
            aria-label={d.compteurs.sheetTitle}
            tabIndex={-1}
            className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col bg-white shadow-pop outline-none"
            initial={reduced ? { opacity: 0 } : { x: 480 }}
            animate={reduced ? { opacity: 1 } : { x: 0 }}
            exit={reduced ? { opacity: 0 } : { x: 480 }}
            transition={reduced ? { duration: 0.15 } : { type: "spring", stiffness: 340, damping: 34 }}
          >
            <div className="flex items-center justify-between border-b border-sand-100 px-5 py-4">
              <h2 className="font-display text-lg font-bold text-ink">{d.compteurs.sheetTitle}</h2>
              <button
                onClick={onClose}
                className="-m-2 flex h-11 w-11 items-center justify-center rounded-lg text-ink-soft hover:bg-sand-100"
                aria-label={d.common.close}
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path strokeLinecap="round" d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </div>

            <form
              id="meter-sheet-form"
              className="flex-1 space-y-4 overflow-y-auto px-5 py-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (real) void submitReal(e.currentTarget);
                else setSubmitted(true);
              }}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                {d.compteurs.sheetGeneral}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <Field label={d.compteurs.sheetProperty}>
                    <Select name="target" defaultValue={options[0]?.id}>
                      {options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <Field label={d.compteurs.sheetSerial}>
                    <Input name="serial" required maxLength={40} placeholder="LU-ENO-…" />
                  </Field>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <Field label={d.compteurs.sheetKind}>
                    <Select value={kind} onChange={(e) => setKind(e.target.value as MeterKind)}>
                      {KINDS.map((k) => (
                        <option key={k} value={k}>
                          {d.status.meter[k]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <Field label={d.compteurs.sheetUnit}>
                    <Input value={METER_UNITS[kind]} readOnly className="bg-sand-50 text-ink-soft" />
                  </Field>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={secondary}
                onClick={() => setSecondary((v) => !v)}
                className="flex items-center gap-3 text-sm font-medium text-ink"
              >
                <span
                  className={
                    "relative h-6 w-10 rounded-full transition-colors duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] " +
                    (secondary ? "bg-brand-600" : "bg-sand-200")
                  }
                  aria-hidden
                >
                  <span
                    className={
                      "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] " +
                      (secondary ? "translate-x-4" : "translate-x-0")
                    }
                  />
                </span>
                {d.compteurs.sheetSecondary}
              </button>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <Field label={d.compteurs.sheetName}>
                    <Input maxLength={80} />
                  </Field>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <Field label={d.compteurs.sheetLocation}>
                    <Input maxLength={120} />
                  </Field>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <Field label={d.compteurs.sheetSupplier}>
                    <Select name="supplier" defaultValue="Enovos">
                      <option>Enovos</option>
                      <option>Sudgaz</option>
                      <option>Ville de Luxembourg</option>
                      <option>Ville d&apos;Esch-sur-Alzette</option>
                      <option>ista</option>
                      <option>Techem</option>
                    </Select>
                  </Field>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <Field label={d.compteurs.sheetContractNo}>
                    <Input maxLength={40} />
                  </Field>
                </div>
                <div className="col-span-2">
                  <Field label={d.compteurs.sheetInterval}>
                    <Select defaultValue="annual">
                      <option value="annual">{d.compteurs.intervalAnnual}</option>
                      <option value="monthly">{d.compteurs.intervalMonthly}</option>
                      <option value="edl">{d.compteurs.intervalEdl}</option>
                    </Select>
                  </Field>
                </div>
                <div className="col-span-2">
                  <Field label={d.compteurs.sheetNote}>
                    <Textarea maxLength={1000} />
                  </Field>
                </div>
              </div>

              {submitted && !real && (
                <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
                  {d.common.demoCreateNotice}
                </p>
              )}
              {error && (
                <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                  {error}
                </p>
              )}
            </form>

            <div className="flex justify-end gap-2 border-t border-sand-100 px-5 py-4">
              <Button variant="ghost" onClick={onClose}>
                {d.common.cancel}
              </Button>
              <Button type="submit" form="meter-sheet-form" disabled={saving}>
                {d.compteurs.sheetCreate}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

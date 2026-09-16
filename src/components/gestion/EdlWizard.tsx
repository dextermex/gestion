"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button, Field, Input, Textarea } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import type { Dict } from "@/lib/i18n/fr";

/**
 * The état des lieux, walked rather than filled in.
 *
 * This is the document that decides, at the end of a tenancy, what may
 * lawfully be deducted from a deposit. A form would get skipped; a walk is
 * followed. So the owner picks the rooms, then goes through them one at a
 * time, then the meters, then the keys — in the order they physically move
 * through the home.
 *
 * Everything lands in `edl_sessions`, `edl_items` and `meter_readings`. The
 * readings taken here are sourced as `edl`, so the meter history says where
 * the number came from and nobody keys it twice.
 */

export type MeterOption = { id: string; label: string; unit: string };

/** What an inspector actually looks at in a room, in the order they look. */
const CATEGORIES = ["paint", "floors", "exterior_joinery", "interior_joinery", "plumbing", "electrics", "appliances"] as const;
type Category = (typeof CATEGORIES)[number];
const CONDITIONS = ["new", "good", "fair", "poor", "damaged"] as const;
type Condition = (typeof CONDITIONS)[number];

type RoomState = { key: string; name: string; items: Record<string, { condition: Condition; notes: string }> };

let seq = 0;
const key = () => `r${++seq}`;

export default function EdlWizard({
  d,
  leaseId,
  kind,
  unitLabel,
  propertyId,
  propertyName,
  meters,
  suggestedRooms,
  real,
  notice,
}: {
  d: Dict;
  leaseId: string;
  kind: "entry" | "exit";
  unitLabel: string;
  propertyId: string;
  propertyName: string;
  meters: MeterOption[];
  suggestedRooms: string[];
  real: boolean;
  notice: string;
}) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [rooms, setRooms] = useState<RoomState[]>(() =>
    suggestedRooms.map((name) => ({ key: key(), name, items: {} })),
  );
  const [newRoom, setNewRoom] = useState("");
  const [readings, setReadings] = useState<Record<string, string>>({});
  const [keysHandedOver, setKeysHandedOver] = useState(kind === "entry");
  const [observations, setObservations] = useState("");
  const [signed, setSigned] = useState(false);
  const [completedAt, setCompletedAt] = useState(() => new Date().toISOString().slice(0, 10));

  // 0 = rooms, 1..n = one room each, n+1 = meters, n+2 = keys, n+3 = done
  const [step, setStep] = useState(0);
  const metersStep = rooms.length + 1;
  const keysStep = metersStep + 1;
  const doneStep = keysStep + 1;
  const total = doneStep;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const setItem = (roomKey: string, cat: Category, patch: Partial<{ condition: Condition; notes: string }>) =>
    setRooms((prev) =>
      prev.map((r) =>
        r.key === roomKey
          ? {
              ...r,
              items: {
                ...r.items,
                [cat]: { ...{ condition: "good" as Condition, notes: "" }, ...r.items[cat], ...patch },
              },
            }
          : r,
      ),
    );

  const recordedItems = rooms.flatMap((r) =>
    Object.entries(r.items).map(([category, v]) => ({
      room: r.name,
      category,
      condition: v.condition,
      notes: v.notes,
    })),
  );

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/edl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaseId,
          kind,
          completedAt,
          signed,
          keysHandedOver,
          items: [
            ...recordedItems,
            ...(observations.trim()
              ? [{ room: d.edlWizard.generalRoom, category: "other", condition: "good", notes: observations }]
              : []),
          ],
          readings: Object.entries(readings)
            .filter(([, v]) => v.trim() !== "")
            .map(([meterId, value]) => ({ meterId, value })),
        }),
      });
      if (res.status === 401) {
        window.location.assign(`/connexion?next=/app/biens/etat-des-lieux?bail=${leaseId}`);
        return;
      }
      if (!res.ok) {
        setError(d.edlWizard.saveFailed);
        setSaving(false);
        return;
      }
      setStep(doneStep);
    } catch {
      setError(d.edlWizard.saveFailed);
    }
    setSaving(false);
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

  const title =
    step === 0
      ? d.edlWizard.roomsTitle
      : step <= rooms.length
        ? rooms[step - 1]?.name ?? ""
        : step === metersStep
          ? d.edlWizard.metersTitle
          : step === keysStep
            ? d.edlWizard.keysTitle
            : "";

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const Heading = (
    <>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-balance text-center font-display text-2xl font-bold tracking-tight text-ink outline-none sm:text-3xl"
      >
        {title}
      </h1>
      <p className="mt-2 text-center text-sm text-ink-soft">
        {kind === "entry" ? d.baux.edlKindEntry : d.baux.edlKindExit} · {unitLabel} · {propertyName}
      </p>
    </>
  );

  const Card = ({ children }: { children: React.ReactNode }) => (
    <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm">{children}</div>
  );

  const overlay = (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-sand-50">
      <div className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-sand-100 bg-white/90 px-4 backdrop-blur sm:px-6">
        {step === 0 || step === doneStep ? (
          <Link
            href={`/app/biens/${propertyId}?onglet=location`}
            className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink"
          >
            <BackIcon />
            {d.location.backToProperty}
          </Link>
        ) : (
          <button
            onClick={() => setStep((s) => s - 1)}
            className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink"
          >
            <BackIcon />
            {d.common.back}
          </button>
        )}
        {step !== doneStep && (
          <p className="absolute left-1/2 hidden -translate-x-1/2 text-sm text-ink-soft sm:block">
            {d.biens.wizStepOf.replace("{n}", String(step + 1)).replace("{total}", String(total))}
          </p>
        )}
      </div>

      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
        <AnimatePresence mode="wait" initial={false}>
          {step === 0 && (
            <motion.div key="rooms" {...slide(-1)}>
              {Heading}
              <Card>
                <p className="text-sm leading-relaxed text-ink-soft">{d.edlWizard.roomsHint}</p>
                <ul className="mt-4 space-y-2">
                  {rooms.map((r) => (
                    <li key={r.key} className="flex items-center gap-2">
                      <Input
                        value={r.name}
                        maxLength={80}
                        onChange={(e) =>
                          setRooms((prev) => prev.map((x) => (x.key === r.key ? { ...x, name: e.target.value } : x)))
                        }
                      />
                      <button
                        aria-label={d.common.delete}
                        onClick={() => setRooms((prev) => prev.filter((x) => x.key !== r.key))}
                        className="shrink-0 text-ink-soft transition hover:text-red-600"
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
                <form
                  className="mt-3 flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newRoom.trim() === "") return;
                    setRooms((prev) => [...prev, { key: key(), name: newRoom.trim(), items: {} }]);
                    setNewRoom("");
                  }}
                >
                  <Input
                    value={newRoom}
                    maxLength={80}
                    placeholder={d.edlWizard.addRoomPlaceholder}
                    onChange={(e) => setNewRoom(e.target.value)}
                  />
                  <Button type="submit" variant="secondary">
                    {d.edlWizard.addRoom}
                  </Button>
                </form>
                <div className="mt-6 flex justify-end">
                  <Button onClick={() => setStep(1)} disabled={rooms.length === 0}>
                    {d.common.next}
                  </Button>
                </div>
              </Card>
            </motion.div>
          )}

          {step >= 1 && step <= rooms.length && rooms[step - 1] && (
            <motion.div key={`room-${rooms[step - 1].key}`} {...slide(1)}>
              {Heading}
              <Card>
                <p className="text-sm leading-relaxed text-ink-soft">{d.edlWizard.roomHint}</p>
                <ul className="mt-4 space-y-3">
                  {CATEGORIES.map((cat) => {
                    const item = rooms[step - 1].items[cat];
                    return (
                      <li key={cat} className="rounded-xl border border-sand-200 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-ink">{d.edlWizard.category[cat]}</span>
                          <div className="flex flex-wrap gap-1">
                            {CONDITIONS.map((c) => (
                              <button
                                key={c}
                                aria-pressed={item?.condition === c}
                                onClick={() => setItem(rooms[step - 1].key, cat, { condition: c })}
                                className={
                                  "tactile rounded-lg px-2.5 py-1 text-[12px] font-semibold transition " +
                                  (item?.condition === c
                                    ? "bg-brand-600 text-white"
                                    : "bg-sand-100 text-ink-soft hover:bg-sand-200")
                                }
                              >
                                {d.edlWizard.condition[c]}
                              </button>
                            ))}
                          </div>
                        </div>
                        {item && (
                          <Input
                            className="mt-2"
                            value={item.notes}
                            maxLength={300}
                            placeholder={d.edlWizard.notePlaceholder}
                            onChange={(e) => setItem(rooms[step - 1].key, cat, { notes: e.target.value })}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-6 flex items-center justify-between">
                  <button onClick={() => setStep(step + 1)} className="text-sm font-semibold text-ink-soft hover:text-ink">
                    {d.edlWizard.skipRoom}
                  </button>
                  <Button onClick={() => setStep(step + 1)}>{d.common.next}</Button>
                </div>
              </Card>
            </motion.div>
          )}

          {step === metersStep && (
            <motion.div key="meters" {...slide(1)}>
              {Heading}
              <Card>
                <p className="text-sm leading-relaxed text-ink-soft">{d.edlWizard.metersHint}</p>
                {meters.length === 0 ? (
                  <p className="mt-4 text-sm text-ink-soft">{d.biens.metersNone}</p>
                ) : (
                  <ul className="mt-4 space-y-3">
                    {meters.map((m) => (
                      <li key={m.id}>
                        <Field label={`${m.label} (${m.unit})`}>
                          <Input
                            inputMode="decimal"
                            className="text-right tabular-nums"
                            value={readings[m.id] ?? ""}
                            onChange={(e) => setReadings((s) => ({ ...s, [m.id]: e.target.value }))}
                          />
                        </Field>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-6 flex justify-end">
                  <Button onClick={() => setStep(keysStep)}>{d.common.next}</Button>
                </div>
              </Card>
            </motion.div>
          )}

          {step === keysStep && (
            <motion.div key="keys" {...slide(1)}>
              {Heading}
              <Card>
                <Field label={d.edlWizard.completedOn}>
                  <Input type="date" value={completedAt} onChange={(e) => setCompletedAt(e.target.value)} />
                </Field>
                <div className="mt-3">
                  <Field label={d.edlWizard.observations}>
                    <Textarea
                      value={observations}
                      maxLength={2000}
                      rows={3}
                      onChange={(e) => setObservations(e.target.value)}
                    />
                  </Field>
                </div>
                <label className="mt-3 flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={keysHandedOver}
                    onChange={(e) => setKeysHandedOver(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-sand-300 text-brand-600 focus:ring-brand-400"
                  />
                  <span className="text-sm text-ink">
                    {kind === "entry" ? d.edlWizard.keysGiven : d.edlWizard.keysReturned}
                  </span>
                </label>
                <label className="mt-2.5 flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={signed}
                    onChange={(e) => setSigned(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-sand-300 text-brand-600 focus:ring-brand-400"
                  />
                  <span className="text-sm text-ink">{d.edlWizard.signedByBoth}</span>
                </label>
                <p className="mt-3 text-xs leading-relaxed text-ink-soft">{d.edlWizard.keysLegal}</p>

                <p className="mt-4 rounded-xl bg-sand-50 px-3.5 py-3 text-sm text-ink-soft">
                  {d.edlWizard.summary
                    .replace("{items}", String(recordedItems.length))
                    .replace("{rooms}", String(rooms.length))}
                </p>
                {error && (
                  <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                    {error}
                  </p>
                )}
                <div className="mt-6 flex justify-end">
                  <Button
                    loading={saving}
                    onClick={() => {
                      if (real) void save();
                      else setStep(doneStep);
                    }}
                  >
                    {d.edlWizard.finish}
                  </Button>
                </div>
              </Card>
            </motion.div>
          )}

          {step === doneStep && (
            <motion.div key="done" {...slide(1)} className="mx-auto max-w-xl text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <Icon name="check" size={28} />
              </span>
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="mt-5 font-display text-2xl font-bold tracking-tight text-ink outline-none"
              >
                {d.edlWizard.doneTitle}
              </h1>
              {real ? (
                <p className="mt-2 text-sm text-ink-soft">{d.edlWizard.doneBody}</p>
              ) : (
                <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                  {notice}
                </p>
              )}
              <Button className="mt-6" onClick={() => router.push(`/app/biens/${propertyId}?onglet=location`)}>
                {d.location.backToProperty}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );

  // The route template animates its wrapper, which would trap a fixed overlay
  // in that stacking context; after mount it escapes to <body>.
  return mounted ? createPortal(overlay, document.body) : overlay;
}

function BackIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7 7-7M3 12h18" />
    </svg>
  );
}

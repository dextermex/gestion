"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button, Field, Input, Textarea } from "@/components/pro/ui";
import { DraftPrompt, StepCard } from "@/components/gestion/WizardChrome";
import { useDraft, useUnloadGuard, type Draft } from "@/lib/draft";
import { shrinkPhotos } from "@/lib/photo";
import { stepParser, useStepHistory } from "@/lib/wizard-history";
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
/** A photograph taken in a room, with the address its thumbnail shows. */
type Shot = { key: string; file: File; url: string };
/** What the device keeps of a walk-through in progress (see src/lib/draft.ts). */
type EdlDraft = {
  rooms: RoomState[];
  readings: Record<string, string>;
  keysHandedOver: boolean;
  observations: string;
  signed: boolean;
  completedAt: string;
  step: number;
  photos: Record<string, File[]>;
};
const DRAFT_VERSION = 1;

let seq = 0;
const key = () => `r${++seq}`;
let shotSeq = 0;
const shotKey = () => `p${++shotSeq}`;

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
  returnTo,
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
  /** Where the owner came from, when the inspection is one step of a larger
   *  journey. Without it the walk-through would be a dead end and the rest of
   *  that journey would never be shown again. */
  returnTo?: string;
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
  // The photos taken in each room, by item, until the walk is saved: they
  // are uploaded one by one to the items the base gives back, then the
  // signed inventory is sealed (its manifest hashed, its report produced).
  const [photos, setPhotos] = useState<Record<string, Shot[]>>({});
  const [phase, setPhase] = useState<"idle" | "photos" | "sealing">("idle");
  const [photoErrors, setPhotoErrors] = useState<string[]>([]);
  const [sealResult, setSealResult] = useState<{ sha256: string; report: { documentId: string; name: string } | null } | null>(null);
  const [sealFailed, setSealFailed] = useState(false);
  const photoKey = (roomKey: string, cat: Category) => `${roomKey}:${cat}`;
  // Brought down to the upload size as they are taken, so the draft and the
  // upload both carry a few hundred kilobytes a photograph, not twenty.
  const addPhotos = (roomKey: string, cat: Category, list: FileList | null) => {
    if (!list || list.length === 0) return;
    const k = photoKey(roomKey, cat);
    void shrinkPhotos(Array.from(list)).then((files) => {
      const shots = files.map((file) => ({ key: shotKey(), file, url: URL.createObjectURL(file) }));
      setPhotos((prev) => ({ ...prev, [k]: [...(prev[k] ?? []), ...shots] }));
    });
  };
  const removePhoto = (roomKey: string, cat: Category, shot: string) => {
    const k = photoKey(roomKey, cat);
    setPhotos((prev) => {
      const gone = (prev[k] ?? []).find((s) => s.key === shot);
      if (gone) URL.revokeObjectURL(gone.url);
      return { ...prev, [k]: (prev[k] ?? []).filter((s) => s.key !== shot) };
    });
  };
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => () => {
    for (const list of Object.values(photosRef.current)) for (const s of list) URL.revokeObjectURL(s.url);
  }, []);
  const photoCount = Object.values(photos).reduce((a, files) => a + files.length, 0);

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

  // The walk-through lives on the device until it is saved: a back gesture,
  // a reload while the camera is open or a dropped tab loses nothing. The
  // draft starts with the first thing recorded, and goes once the base has it.
  const dirty = step > 0 || recordedItems.length > 0 || photoCount > 0;
  const draftData = useMemo<EdlDraft>(
    () => ({
      rooms,
      readings,
      keysHandedOver,
      observations,
      signed,
      completedAt,
      step,
      photos: Object.fromEntries(Object.entries(photos).map(([k, list]) => [k, list.map((s) => s.file)])),
    }),
    [rooms, readings, keysHandedOver, observations, signed, completedAt, step, photos],
  );
  const [pending, setPending] = useState<Draft<EdlDraft> | null>(null);
  const clearDraft = useDraft(`edl:${leaseId}:${kind}`, DRAFT_VERSION, draftData, dirty && step !== doneStep && !saving, setPending);
  useUnloadGuard(dirty && step !== doneStep);
  const resumeDraft = () => {
    if (!pending) return;
    const data = pending.data;
    for (const r of data.rooms) seq = Math.max(seq, Number(r.key.replace(/\D/g, "")) || 0);
    setRooms(data.rooms);
    setReadings(data.readings);
    setKeysHandedOver(data.keysHandedOver);
    setObservations(data.observations);
    setSigned(data.signed);
    setCompletedAt(data.completedAt);
    setPhotos(
      Object.fromEntries(
        Object.entries(data.photos).map(([k, files]) => [k, files.map((file) => ({ key: shotKey(), file, url: URL.createObjectURL(file) }))]),
      ),
    );
    setStep(Math.min(Math.max(0, data.step), data.rooms.length + 2));
    setPending(null);
  };
  const discardDraft = () => {
    void clearDraft();
    setPending(null);
  };
  useEffect(() => {
    if (step === doneStep) void clearDraft();
  }, [step, doneStep, clearDraft]);

  // One history entry per step: the phone's back gesture returns to the previous room.
  const { back } = useStepHistory(step, setStep, stepParser(0, doneStep));

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
      const payload = (await res.json().catch(() => ({}))) as { id?: string; itemRows?: Array<{ id: string; room: string; category: string }> };
      const sessionId = String(payload.id ?? "");
      void clearDraft();
      const itemRows = payload.itemRows ?? [];
      // Each photo goes to the item it was taken for: the base's row for
      // that room and category. A failed upload is named, never dropped
      // silently, and the inventory stands without it.
      const failed: string[] = [];
      if (sessionId && photoCount > 0) {
        setPhase("photos");
        for (const r of rooms) {
          for (const cat of CATEGORIES) {
            const shots = photos[photoKey(r.key, cat)] ?? [];
            if (shots.length === 0) continue;
            const target = itemRows.find((x) => x.room === r.name.trim().slice(0, 80) && x.category === cat);
            for (const { file } of shots) {
              if (!target) {
                failed.push(file.name);
                continue;
              }
              const fd = new FormData();
              fd.set("file", file);
              fd.set("itemId", target.id);
              const up = await fetch(`/api/edl/${encodeURIComponent(sessionId)}/photos`, { method: "POST", body: fd }).catch(() => null);
              if (!up || !up.ok) failed.push(file.name);
            }
          }
        }
      }
      setPhotoErrors(failed);
      if (sessionId && signed && recordedItems.length > 0) {
        setPhase("sealing");
        const sealRes = await fetch(`/api/edl/${encodeURIComponent(sessionId)}/sceller`, { method: "POST" }).catch(() => null);
        if (sealRes && sealRes.ok) {
          const sealed = (await sealRes.json().catch(() => ({}))) as { sha256?: string; report?: { documentId: string; name: string } | null };
          setSealResult({ sha256: String(sealed.sha256 ?? ""), report: sealed.report ?? null });
        } else setSealFailed(true);
      }
      setPhase("idle");
      setStep(doneStep);
    } catch {
      setError(d.edlWizard.saveFailed);
    }
    setPhase("idle");
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

  const overlay = (
    <div className="journey-shell fixed inset-0 z-[60] overflow-y-auto bg-sand-50">
      <div className="journey-topbar sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-sand-100 bg-white/90 px-4 backdrop-blur sm:px-6">
        {step === 0 || step === doneStep ? (
          <Link
            href={returnTo ?? `/app/biens/${propertyId}?onglet=location`}
            className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink max-sm:min-h-11"
          >
            <BackIcon />
            {returnTo ? d.edlWizard.continueDossier : d.location.backToProperty}
          </Link>
        ) : (
          <button
            onClick={() => back(() => setStep((s) => Math.max(0, s - 1)))}
            className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink max-sm:min-h-11"
          >
            <BackIcon />
            {d.common.back}
          </button>
        )}
        {step !== doneStep && (
          <p className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-sm text-ink-soft">
            {d.biens.wizStepOf.replace("{n}", String(step + 1)).replace("{total}", String(total))}
          </p>
        )}
      </div>

      <div className="mx-auto w-full max-w-4xl px-safe-4 pb-[max(2.5rem,calc(var(--safe-bottom)+1.5rem))] pt-10 sm:px-safe-6">
        <AnimatePresence mode="wait" initial={false}>
          {step === 0 && (
            <motion.div key="rooms" {...slide(-1)}>
              {Heading}
              {pending && !dirty && <DraftPrompt d={d} savedAt={pending.savedAt} onResume={resumeDraft} onDiscard={discardDraft} />}
              <StepCard>
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
                        className="shrink-0 text-ink-soft transition hover:text-red-600 max-sm:-mr-2 max-sm:flex max-sm:h-11 max-sm:w-11 max-sm:items-center max-sm:justify-center max-sm:rounded-lg"
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
              </StepCard>
            </motion.div>
          )}

          {step >= 1 && step <= rooms.length && rooms[step - 1] && (
            <motion.div key={`room-${rooms[step - 1].key}`} {...slide(1)}>
              {Heading}
              <StepCard>
                <p className="text-sm leading-relaxed text-ink-soft">{d.edlWizard.roomHint}</p>
                <ul className="mt-4 space-y-3">
                  {CATEGORIES.map((cat) => {
                    const item = rooms[step - 1].items[cat];
                    return (
                      <li key={cat} className="rounded-xl border border-sand-200 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 max-sm:flex-col max-sm:items-stretch">
                          <span className="text-sm font-semibold text-ink">{d.edlWizard.category[cat]}</span>
                          <div className="flex flex-wrap gap-1 max-sm:grid max-sm:grid-cols-5 max-sm:gap-1.5 max-[23rem]:grid-cols-3" data-conditions={cat}>
                            {CONDITIONS.map((c) => (
                              <button
                                key={c}
                                aria-pressed={item?.condition === c}
                                onClick={() => setItem(rooms[step - 1].key, cat, { condition: c })}
                                className={
                                  "tactile whitespace-nowrap rounded-lg px-2.5 py-1 text-[12px] font-semibold transition max-sm:min-h-11 max-sm:px-0.5 " +
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
                          <>
                            <Input
                              className="mt-2"
                              value={item.notes}
                              maxLength={300}
                              placeholder={d.edlWizard.notePlaceholder}
                              onChange={(e) => setItem(rooms[step - 1].key, cat, { notes: e.target.value })}
                            />
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <label className="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-sand-200 bg-white px-3 text-xs font-semibold text-brand-700 hover:border-brand-300 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-600 max-sm:min-h-11 max-sm:text-sm">
                                {d.edlWizard.addPhoto}
                                <input
                                  type="file"
                                  accept="image/jpeg,image/png,image/webp,image/avif"
                                  multiple
                                  className="sr-only"
                                  data-photo-input={cat}
                                  onChange={(e) => {
                                    addPhotos(rooms[step - 1].key, cat, e.target.files);
                                    e.target.value = "";
                                  }}
                                />
                              </label>
                              {(photos[photoKey(rooms[step - 1].key, cat)]?.length ?? 0) > 0 && (
                                <span className="text-[11px] text-ink-soft" data-photo-count={cat}>
                                  {d.edlWizard.photoCount.replace("{n}", String(photos[photoKey(rooms[step - 1].key, cat)].length))}
                                </span>
                              )}
                            </div>
                            {(photos[photoKey(rooms[step - 1].key, cat)]?.length ?? 0) > 0 && (
                              <ul className="mt-2 grid grid-cols-3 gap-2" data-photo-list={cat}>
                                {photos[photoKey(rooms[step - 1].key, cat)].map((shot) => (
                                  <li key={shot.key} className="relative overflow-hidden rounded-xl border border-sand-200 bg-sand-100">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={shot.url} alt="" className="aspect-[4/3] w-full object-cover" />
                                    <button
                                      type="button"
                                      aria-label={d.common.removePhoto}
                                      onClick={() => removePhoto(rooms[step - 1].key, cat, shot.key)}
                                      className="tactile absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-ink"
                                    >
                                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/95 shadow-sm">
                                        <Icon name="x" size={16} />
                                      </span>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-6 flex items-center justify-between">
                  <button onClick={() => setStep(step + 1)} className="text-sm font-semibold text-ink-soft hover:text-ink max-sm:min-h-11 max-sm:px-2">
                    {d.edlWizard.skipRoom}
                  </button>
                  <Button onClick={() => setStep(step + 1)}>{d.common.next}</Button>
                </div>
              </StepCard>
            </motion.div>
          )}

          {step === metersStep && (
            <motion.div key="meters" {...slide(1)}>
              {Heading}
              <StepCard>
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
              </StepCard>
            </motion.div>
          )}

          {step === keysStep && (
            <motion.div key="keys" {...slide(1)}>
              {Heading}
              <StepCard>
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
                {signed && real && <p className="mt-2 pl-6 text-xs leading-relaxed text-brand-800">{d.edlWizard.seal}</p>}
                <p className="mt-3 text-xs leading-relaxed text-ink-soft">{d.edlWizard.keysLegal}</p>

                <p className="mt-4 rounded-xl bg-sand-50 px-3.5 py-3 text-sm text-ink-soft">
                  {d.edlWizard.summary
                    .replace("{items}", String(recordedItems.length))
                    .replace("{rooms}", String(rooms.length))}
                  {photoCount > 0 ? ` ${d.edlWizard.photoCount.replace("{n}", String(photoCount))}` : ""}
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
                    {phase === "sealing" ? d.edlWizard.sealing : d.edlWizard.finish}
                  </Button>
                </div>
              </StepCard>
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
                <>
                  <p className="mt-2 text-sm text-ink-soft">{d.edlWizard.doneBody}</p>
                  {sealResult && (
                    <p role="status" className="mt-3 break-all rounded-xl bg-brand-50 px-4 py-3 text-xs font-semibold text-brand-800" data-edl-sealed={sealResult.sha256}>
                      {d.edlWizard.sealed.replace("{sha}", sealResult.sha256)}
                    </p>
                  )}
                  {sealResult &&
                    (sealResult.report ? (
                      <a
                        href={`/api/documents/${encodeURIComponent(sealResult.report.documentId)}/fichier`}
                        className="mt-2 inline-flex min-h-10 items-center text-sm font-semibold text-brand-700 hover:underline"
                        data-edl-report-link={sealResult.report.documentId}
                      >
                        {d.baux.edlReport} · {sealResult.report.name}
                      </a>
                    ) : (
                      <p className="mt-2 text-xs text-amber-800" data-edl-report-missing>
                        {d.edlWizard.reportMissing}
                      </p>
                    ))}
                  {sealFailed && (
                    <p role="alert" className="mt-2 text-xs font-semibold text-red-700">
                      {d.edlWizard.sealFailed}
                    </p>
                  )}
                  {photoErrors.map((name) => (
                    <p key={name} role="alert" className="mt-2 text-xs font-semibold text-red-700">
                      {d.edlWizard.photoFailed.replace("{name}", name)}
                    </p>
                  ))}
                </>
              ) : (
                <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                  {notice}
                </p>
              )}
              <div className="mt-6 flex flex-col gap-2.5">
                {returnTo && (
                  <Button onClick={() => router.push(returnTo)}>{d.edlWizard.continueDossier}</Button>
                )}
                <Button
                  variant={returnTo ? "secondary" : "primary"}
                  onClick={() => router.push(`/app/biens/${propertyId}?onglet=location`)}
                >
                  {d.location.backToProperty}
                </Button>
              </div>
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

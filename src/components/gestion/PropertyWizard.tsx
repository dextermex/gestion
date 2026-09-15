"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button, Field, Input, Select } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import type { Dict } from "@/lib/i18n/fr";

/**
 * Adding a property, as a guided journey rather than one long form.
 *
 * The owner is asked what they are creating, and every later step adapts to
 * that answer: a house is never asked how many lots it holds, a commercial
 * unit is never asked for bedrooms. Anything that can honestly wait is
 * skippable, because a half-known property is still worth having.
 *
 * On a real account each step's answers go to `/api/biens/create` in one
 * write, and the photographs follow into the private bucket. On a sample
 * cabinet the same journey ends on the standard notice: nothing is invented
 * and nothing is stored.
 */

type PropertyType = "apartment" | "house" | "building" | "commercial" | "other";

const TYPE_ICONS: Record<PropertyType, React.ReactNode> = {
  apartment: (
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
  building: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-8 w-8" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 21h18M5 21V5.5A1.5 1.5 0 0 1 6.5 4h6A1.5 1.5 0 0 1 14 5.5V21M14 9h4.5A1.5 1.5 0 0 1 20 10.5V21M8 8h3M8 12h3M8 16h3M17 13h.01M17 17h.01"
      />
    </svg>
  ),
  commercial: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-8 w-8" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 9h16l-1-5H5zM5 9v11h14V9M9 20v-6h4v6M15 13h2v3h-2z" />
    </svg>
  ),
  other: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-8 w-8" aria-hidden>
      <rect x="3.5" y="7" width="17" height="13" rx="1.5" />
      <path strokeLinecap="round" d="M8 7V4.5h8V7M8 12h8M8 16h5" />
    </svg>
  ),
};

/** Lots only exist as a question for a container. */
const NEEDS_UNITS: PropertyType = "building";
/** Rooms and bedrooms only make sense for a home. */
const DWELLING: PropertyType[] = ["apartment", "house", "other"];

type UnitDraft = { key: string; label: string; kind: string; floor: string; areaSqm: string };
type Photo = { key: string; file: File; url: string };

let seq = 0;
const nextKey = () => `u${++seq}`;

export default function PropertyWizard({
  d,
  notice,
  noticeTone = "demo",
  real = false,
}: {
  d: Dict;
  /** Demo end-screen message (sample cabinets only). */
  notice: string;
  noticeTone?: "demo" | "pending";
  /** Real account: submitting WRITES to gestion.* and lands on the sheet. */
  real?: boolean;
}) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [type, setType] = useState<PropertyType | null>(null);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [createdUnits, setCreatedUnits] = useState<Array<{ id: string; label: string }>>([]);

  // Step 2
  const [name, setName] = useState("");
  const [street, setStreet] = useState("");
  const [num, setNum] = useState("");
  const [postal, setPostal] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("LU");
  const [areaSqm, setAreaSqm] = useState("");
  const [rooms, setRooms] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [floor, setFloor] = useState("");
  const [year, setYear] = useState("");

  // Step 3
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [coverKey, setCoverKey] = useState<string | null>(null);

  // Step 4
  const [units, setUnits] = useState<UnitDraft[]>([]);

  // Step 5
  const [energyClass, setEnergyClass] = useState("");
  const [cadastralCommune, setCadastralCommune] = useState("");
  const [cadastralSection, setCadastralSection] = useState("");
  const [cadastralNumber, setCadastralNumber] = useState("");
  const [syndicName, setSyndicName] = useState("");

  const needsUnits = type === NEEDS_UNITS;
  const isDwelling = type !== null && DWELLING.includes(type);
  // Step 4 only exists for a container; the numbering follows.
  const flow = useMemo(
    () => (needsUnits ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 5, 6]),
    [needsUnits],
  );
  const position = flow.indexOf(step) + 1;
  const canSubmit = name.trim() !== "" && street.trim() !== "" && city.trim() !== "";

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  // Object URLs are a resource: release them when the wizard goes away.
  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), [photos]);

  const go = (delta: 1 | -1) => {
    const i = flow.indexOf(step);
    const next = flow[i + delta];
    if (next !== undefined) setStep(next);
  };

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    const added = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, 12)
      .map((file) => ({ key: `${file.name}-${file.size}-${file.lastModified}`, file, url: URL.createObjectURL(file) }));
    setPhotos((prev) => {
      const merged = [...prev];
      for (const p of added) if (!merged.some((m) => m.key === p.key)) merged.push(p);
      return merged.slice(0, 12);
    });
    setCoverKey((c) => c ?? added[0]?.key ?? null);
  };

  const removePhoto = (key: string) => {
    setPhotos((prev) => {
      const gone = prev.find((p) => p.key === key);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((p) => p.key !== key);
    });
    setCoverKey((c) => (c === key ? null : c));
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/biens/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          name,
          street,
          number: num,
          postal,
          city,
          country,
          constructionYear: year,
          energyClass: energyClass || undefined,
          cadastralCommune,
          cadastralSection,
          cadastralNumber,
          syndicName,
          isCopropriete: type === "apartment" || syndicName.trim() !== "",
          // The implied single lot for a home or a shop.
          unitLabel: name,
          floor,
          areaSqm,
          rooms: isDwelling ? rooms : "",
          bedrooms: isDwelling ? bedrooms : "",
          units: units
            .filter((u) => u.label.trim() !== "")
            .map((u) => ({ label: u.label, kind: u.kind, floor: u.floor, areaSqm: u.areaSqm })),
        }),
      });
      if (res.status === 401) {
        window.location.assign("/connexion?next=/app/biens/nouveau");
        return;
      }
      if (!res.ok) {
        setSaveError(d.biens.wizSaveFailed);
        setSaving(false);
        return;
      }
      const created = (await res.json()) as { id: string; units?: Array<{ id: string; label: string }> };
      setCreatedId(created.id);
      setCreatedUnits(created.units ?? []);

      // The photographs follow the property they belong to. A failed upload
      // never loses the property: the sheet simply has no cover yet.
      const ordered = coverKey ? [...photos].sort((a, b) => (a.key === coverKey ? -1 : b.key === coverKey ? 1 : 0)) : photos;
      for (const photo of ordered) {
        const body = new FormData();
        body.append("file", photo.file);
        body.append("propertyId", created.id);
        const up = await fetch("/api/biens/photo", { method: "POST", body });
        if (!up.ok) {
          setSaveError(d.biens.wizPhotoFailed);
          break;
        }
      }
      setStep(6);
    } catch {
      setSaveError(d.biens.wizSaveFailed);
    }
    setSaving(false);
  };

  const submit = () => {
    if (!canSubmit || saving) return;
    if (real) void save();
    else setStep(6);
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

  const types: Array<{ id: PropertyType; title: string; body: string }> = [
    { id: "apartment", title: d.biens.wizTypeApartment, body: d.biens.wizTypeApartmentBody },
    { id: "house", title: d.biens.wizTypeHouse, body: d.biens.wizTypeHouseBody },
    { id: "building", title: d.biens.wizTypeBuilding, body: d.biens.wizTypeBuildingBody },
    { id: "commercial", title: d.biens.wizTypeCommercial, body: d.biens.wizTypeCommercialBody },
    { id: "other", title: d.biens.wizTypeOther, body: d.biens.wizTypeOtherBody },
  ];

  const stepTitle =
    step === 1
      ? d.biens.wizTitle1
      : step === 2
        ? d.biens.wizTitle2
        : step === 3
          ? d.biens.wizTitlePhotos
          : step === 4
            ? d.biens.wizTitleUnits
            : step === 5
              ? d.biens.wizTitleTech
              : "";

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const Heading = (
    <h1
      ref={headingRef}
      tabIndex={-1}
      className="text-balance text-center font-display text-2xl font-bold tracking-tight text-ink outline-none sm:text-3xl"
    >
      {stepTitle}
    </h1>
  );

  const overlay = (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-sand-50">
      <div className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-sand-100 bg-white/90 px-4 backdrop-blur sm:px-6">
        {step === 1 || step === 6 ? (
          <Link href="/app/biens" className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink">
            <BackIcon />
            {d.biens.wizBack}
          </Link>
        ) : (
          <button onClick={() => go(-1)} className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink">
            <BackIcon />
            {d.common.back}
          </button>
        )}
        {step !== 6 && (
          <p className="absolute left-1/2 hidden -translate-x-1/2 text-sm text-ink-soft sm:block">
            {d.biens.wizStepOf.replace("{n}", String(position)).replace("{total}", String(flow.length - 1))}
          </p>
        )}
        <div className="flex-1" />
        {step === 5 && (
          <Button onClick={submit} disabled={!canSubmit} loading={saving}>
            {d.biens.wizCreate}
          </Button>
        )}
      </div>

      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
        <AnimatePresence mode="wait" initial={false}>
          {step === 1 && (
            <motion.div key="s1" {...slide(-1)}>
              {Heading}
              <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
                {types.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setType(t.id);
                      setStep(2);
                    }}
                    className="tactile group flex flex-col items-center rounded-2xl border border-sand-200 bg-white p-6 text-center shadow-sm transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md motion-reduce:hover:translate-y-0"
                  >
                    <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
                      {TYPE_ICONS[t.id]}
                    </span>
                    <span className="mt-4 font-display text-base font-bold text-ink">{t.title}</span>
                    <span className="mt-1.5 text-sm leading-relaxed text-ink-soft">{t.body}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="s2" {...slide(1)}>
              {Heading}
              <form
                className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canSubmit) go(1);
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
                    <Input maxLength={10} value={num} onChange={(e) => setNum(e.target.value)} />
                  </Field>
                  <Field label={d.biens.wizPostal}>
                    <Input maxLength={10} placeholder="L-" value={postal} onChange={(e) => setPostal(e.target.value)} />
                  </Field>
                  <div className="col-span-2">
                    <Field label={d.biens.wizCity}>
                      <Input required maxLength={80} value={city} onChange={(e) => setCity(e.target.value)} />
                    </Field>
                  </div>
                  <div className="col-span-3">
                    <Field label={d.biens.wizCountry}>
                      <Select value={country} onChange={(e) => setCountry(e.target.value)}>
                        <option value="LU">Luxembourg</option>
                        <option value="FR">France</option>
                        <option value="BE">Belgique</option>
                        <option value="DE">Deutschland</option>
                      </Select>
                    </Field>
                  </div>
                </div>

                <h2 className="mt-6 font-display text-lg font-bold text-ink">{d.biens.wizCharacteristics}</h2>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {!needsUnits && (
                    <Field label={d.biens.wizSurface}>
                      <Input inputMode="decimal" value={areaSqm} onChange={(e) => setAreaSqm(e.target.value)} />
                    </Field>
                  )}
                  {isDwelling && (
                    <>
                      <Field label={d.biens.wizRooms}>
                        <Input inputMode="numeric" value={rooms} onChange={(e) => setRooms(e.target.value)} />
                      </Field>
                      <Field label={d.biens.wizBedrooms}>
                        <Input inputMode="numeric" value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} />
                      </Field>
                    </>
                  )}
                  {type === "apartment" && (
                    <Field label={d.biens.wizFloor}>
                      <Input maxLength={20} value={floor} onChange={(e) => setFloor(e.target.value)} />
                    </Field>
                  )}
                  <Field label={d.biens.wizYear}>
                    <Input inputMode="numeric" maxLength={4} value={year} onChange={(e) => setYear(e.target.value)} />
                  </Field>
                </div>

                <div className="mt-6 flex justify-end">
                  <Button type="submit" disabled={!canSubmit}>
                    {d.common.next}
                  </Button>
                </div>
              </form>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div key="s3" {...slide(1)}>
              {Heading}
              <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm">
                <p className="text-sm leading-relaxed text-ink-soft">{d.biens.wizPhotosHint}</p>
                <label className="tactile mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-sand-300 bg-sand-50 px-4 py-8 text-center transition hover:border-brand-300 hover:bg-brand-50/40">
                  <Icon name="plus" size={22} className="text-ink-soft" />
                  <span className="mt-2 text-sm font-semibold text-ink">{d.biens.wizAddPhotos}</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    multiple
                    className="sr-only"
                    onChange={(e) => addPhotos(e.target.files)}
                  />
                </label>

                {photos.length > 0 && (
                  <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {photos.map((p) => (
                      <li key={p.key} className="group relative overflow-hidden rounded-xl border border-sand-200">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt="" className="aspect-[4/3] w-full object-cover" />
                        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-white/90 px-2 py-1.5 backdrop-blur">
                          {coverKey === p.key ? (
                            <span className="text-[11px] font-bold text-brand-700">{d.biens.wizCover}</span>
                          ) : (
                            <button
                              onClick={() => setCoverKey(p.key)}
                              className="text-[11px] font-semibold text-ink-soft hover:text-brand-700"
                            >
                              {d.biens.wizSetCover}
                            </button>
                          )}
                          <button
                            onClick={() => removePhoto(p.key)}
                            aria-label={d.common.delete}
                            className="text-ink-soft hover:text-red-600"
                          >
                            <Icon name="trash" size={14} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-6 flex items-center justify-between">
                  <button onClick={() => go(1)} className="text-sm font-semibold text-ink-soft hover:text-ink">
                    {d.biens.wizLater}
                  </button>
                  <Button onClick={() => go(1)}>{d.common.next}</Button>
                </div>
              </div>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div key="s4" {...slide(1)}>
              {Heading}
              <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm">
                <p className="text-sm leading-relaxed text-ink-soft">{d.biens.wizUnitsHint}</p>

                {units.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {units.map((u, i) => (
                      <li key={u.key} className="grid grid-cols-12 items-end gap-2">
                        <div className="col-span-4">
                          <Field label={i === 0 ? d.biens.wizUnitLabel : ""}>
                            <Input
                              value={u.label}
                              maxLength={60}
                              onChange={(e) =>
                                setUnits((prev) => prev.map((x) => (x.key === u.key ? { ...x, label: e.target.value } : x)))
                              }
                            />
                          </Field>
                        </div>
                        <div className="col-span-3">
                          <Field label={i === 0 ? d.biens.wizUnitKind : ""}>
                            <Select
                              value={u.kind}
                              onChange={(e) =>
                                setUnits((prev) => prev.map((x) => (x.key === u.key ? { ...x, kind: e.target.value } : x)))
                              }
                            >
                              <option value="dwelling">{d.biens.wizKindDwelling}</option>
                              <option value="commercial">{d.biens.wizKindCommercial}</option>
                              <option value="office">{d.biens.wizKindOffice}</option>
                              <option value="parking">{d.biens.wizKindParking}</option>
                              <option value="cellar">{d.biens.wizKindCellar}</option>
                            </Select>
                          </Field>
                        </div>
                        <div className="col-span-2">
                          <Field label={i === 0 ? d.biens.wizFloor : ""}>
                            <Input
                              value={u.floor}
                              maxLength={20}
                              onChange={(e) =>
                                setUnits((prev) => prev.map((x) => (x.key === u.key ? { ...x, floor: e.target.value } : x)))
                              }
                            />
                          </Field>
                        </div>
                        <div className="col-span-2">
                          <Field label={i === 0 ? d.biens.wizSurface : ""}>
                            <Input
                              inputMode="decimal"
                              value={u.areaSqm}
                              onChange={(e) =>
                                setUnits((prev) => prev.map((x) => (x.key === u.key ? { ...x, areaSqm: e.target.value } : x)))
                              }
                            />
                          </Field>
                        </div>
                        <button
                          onClick={() => setUnits((prev) => prev.filter((x) => x.key !== u.key))}
                          aria-label={d.common.delete}
                          className="col-span-1 mb-2 justify-self-center text-ink-soft hover:text-red-600"
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <button
                  onClick={() =>
                    setUnits((prev) => [
                      ...prev,
                      { key: nextKey(), label: "", kind: "dwelling", floor: "", areaSqm: "" },
                    ])
                  }
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline"
                >
                  <Icon name="plus" size={15} />
                  {d.biens.wizAddUnit}
                </button>

                <div className="mt-6 flex items-center justify-between">
                  <button onClick={() => go(1)} className="text-sm font-semibold text-ink-soft hover:text-ink">
                    {d.biens.wizLater}
                  </button>
                  <Button onClick={() => go(1)}>{d.common.next}</Button>
                </div>
              </div>
            </motion.div>
          )}

          {step === 5 && (
            <motion.div key="s5" {...slide(1)}>
              {Heading}
              <form
                className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <p className="text-sm leading-relaxed text-ink-soft">{d.biens.wizTechHint}</p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Field label={d.biens.wizEnergyClass}>
                    <Select value={energyClass} onChange={(e) => setEnergyClass(e.target.value)}>
                      <option value="">{d.biens.cpeMissing}</option>
                      {["A+", "A", "B", "C", "D", "E", "F", "G", "H", "I"].map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={d.biens.syndic}>
                    <Input maxLength={120} value={syndicName} onChange={(e) => setSyndicName(e.target.value)} />
                  </Field>
                </div>
                <h2 className="mt-6 font-display text-lg font-bold text-ink">{d.bien.cadastral}</h2>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <Field label={d.bien.commune}>
                    <Input maxLength={80} value={cadastralCommune} onChange={(e) => setCadastralCommune(e.target.value)} />
                  </Field>
                  <Field label={d.biens.wizSection}>
                    <Input maxLength={20} value={cadastralSection} onChange={(e) => setCadastralSection(e.target.value)} />
                  </Field>
                  <Field label={d.biens.wizParcel}>
                    <Input maxLength={40} value={cadastralNumber} onChange={(e) => setCadastralNumber(e.target.value)} />
                  </Field>
                </div>

                {saveError && (
                  <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                    {saveError}
                  </p>
                )}
                <div className="mt-6 flex items-center justify-between">
                  <button type="button" onClick={submit} className="text-sm font-semibold text-ink-soft hover:text-ink">
                    {d.biens.wizLater}
                  </button>
                  <Button type="submit" disabled={!canSubmit} loading={saving}>
                    {d.biens.wizCreate}
                  </Button>
                </div>
              </form>
            </motion.div>
          )}

          {step === 6 && (
            <motion.div key="s6" {...slide(1)} className="mx-auto max-w-xl text-center">
              <span
                className={
                  "mx-auto flex h-14 w-14 items-center justify-center rounded-full " +
                  (real || noticeTone === "demo" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")
                }
              >
                <Icon name="check" size={28} />
              </span>
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="mt-5 font-display text-2xl font-bold tracking-tight text-ink outline-none"
              >
                {d.biens.wizDoneTitle.replace("{name}", name)}
              </h1>

              {real ? (
                <>
                  <p className="mt-2 text-sm text-ink-soft">{d.biens.wizDoneBody}</p>
                  {saveError && (
                    <p role="alert" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                      {saveError}
                    </p>
                  )}
                  <div className="mt-6 flex flex-col gap-2.5">
                    {createdUnits.length > 0 && (
                      <Button onClick={() => router.push(`/app/biens/locataire?lot=${createdUnits[0].id}`)}>
                        {d.bien.addTenant}
                      </Button>
                    )}
                    <Button variant="secondary" onClick={() => router.push(`/app/biens/${createdId}?onglet=documents`)}>
                      {d.biens.wizDoneDocuments}
                    </Button>
                    <Button variant="secondary" onClick={() => router.push(`/app/biens/${createdId}?onglet=interventions`)}>
                      {d.biens.wizDoneIntervention}
                    </Button>
                    <button
                      onClick={() => router.push(`/app/biens/${createdId}`)}
                      className="mt-1 text-sm font-semibold text-ink-soft hover:text-ink"
                    >
                      {d.biens.wizDoneFinish}
                    </button>
                  </div>
                </>
              ) : (
                <>
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
                </>
              )}
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

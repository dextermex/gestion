"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CountryCode } from "libphonenumber-js/min";
import { countriesFor } from "@/lib/signup/phone";
import type { Locale } from "@/lib/i18n/config";
import type { SignupCopy } from "@/lib/i18n/signup";

export default function CountryPicker({ value, onChange, locale, copy }: {
  value: CountryCode; onChange: (code: CountryCode) => void; locale: Locale; copy: SignupCopy;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const countries = useMemo(() => countriesFor(locale), [locale]);
  const selected = countries.find((country) => country.code === value)!;
  const normalized = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const filtered = countries.filter((country) => (country.name + country.code + country.dial).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(normalized));
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (open) { dialog.current?.showModal(); search.current?.focus(); }
    else dialog.current?.close();
  }, [open]);
  return <>
    <button ref={trigger} className="signup-country" type="button" aria-label={copy.country + ": " + selected.name + " " + selected.dial} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setQuery(""); setOpen(true); }}>
      <span aria-hidden="true" className="signup-flag">{selected.flag}</span><span>{selected.dial}</span>
      <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
    </button>
    <dialog ref={dialog} className="signup-country-dialog" aria-labelledby="country-title" onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === dialog.current) { const r = dialog.current.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } }}>
      <div className="signup-dialog-head"><h2 id="country-title">{copy.countries}</h2><button className="signup-icon-button" type="button" aria-label={copy.close} onClick={close}>×</button></div>
      <label className="signup-search"><span className="sr-only">{copy.searchCountry}</span><input ref={search} type="search" placeholder={copy.searchCountry} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      {open && <div className="signup-country-list">
        {filtered.map((country) => <button type="button" key={country.code} className="signup-country-option" aria-pressed={value === country.code} onClick={() => { onChange(country.code); close(); }}><span aria-hidden="true">{country.flag}</span><span>{country.name}</span><span>{country.dial}</span>{country.code === value && <span aria-hidden="true">✓</span>}</button>)}
        {filtered.length === 0 && <p className="signup-empty">{copy.noCountries}</p>}
      </div>}
    </dialog>
  </>;
}

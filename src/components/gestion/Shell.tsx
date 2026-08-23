"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useDebounced } from "@/lib/hooks";
import { useDismiss } from "@/lib/useDismiss";
import { Spinner } from "@/components/pro/ui";
import GestionLogo from "./GestionLogo";
import { CONTACTS, LEASES, PROPERTIES, UNITS, leaseTenantNames, leaseUnitLabel, propertyById } from "@/lib/demo/data";

/* --------------------------------- nav model --------------------------------
   The immocloud workflow set (Dashboard, Workflows, Objects, Tenancies,
   Meters, Operating costs, Contacts, Rent, Finance, Banking, Messaging,
   Rental contracts, Documents) + the Luxembourg compliance modules that are
   the product's moat. Labels in French — the Gestion app UI is French-only,
   like the rest of the Morada ecosystem's app surfaces. */

type NavItem = { href: string; label: string };
type NavGroup = { title: string | null; items: NavItem[] };

export const NAV: NavGroup[] = [
  { title: null, items: [{ href: "/app", label: "Accueil" }] },
  {
    title: "Gestion",
    items: [
      { href: "/app/workflows", label: "Workflows" },
      { href: "/app/biens", label: "Biens" },
      { href: "/app/baux", label: "Baux" },
      { href: "/app/compteurs", label: "Compteurs" },
      { href: "/app/charges", label: "Charges" },
    ],
  },
  {
    title: "Relations",
    items: [
      { href: "/app/contacts", label: "Contacts" },
      { href: "/app/messages", label: "Messages" },
    ],
  },
  {
    title: "Finances",
    items: [
      { href: "/app/loyers", label: "Loyers" },
      { href: "/app/finance", label: "Finance" },
      { href: "/app/banque", label: "Banque" },
    ],
  },
  {
    title: "Contrats & documents",
    items: [
      { href: "/app/contrats", label: "Contrats de bail" },
      { href: "/app/documents", label: "Documents" },
    ],
  },
  {
    title: "Conformité Luxembourg",
    items: [
      { href: "/app/conformite", label: "Conformité" },
      { href: "/app/indexation", label: "Indexation" },
      { href: "/app/garanties", label: "Garanties" },
      { href: "/app/aml", label: "AML / KYC" },
      { href: "/app/fiscalite", label: "Fiscalité" },
    ],
  },
];

const QUICK_ADD: { label: string; href: string }[] = [
  { label: "Bien", href: "/app/biens?new=1" },
  { label: "Bail", href: "/app/contrats?new=1" },
  { label: "Contact", href: "/app/contacts?new=1" },
  { label: "Paiement", href: "/app/banque?new=1" },
  { label: "Intervention", href: "/app/workflows?new=1" },
  { label: "Document", href: "/app/documents?new=1" },
];

/* ----------------------------------- shell ---------------------------------- */

export default function GestionShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // ⌘K / Ctrl-K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setPaletteOpen(false);
  }, [pathname]);

  const isActivePath = (href: string) =>
    href === "/app" ? pathname === "/app" : pathname.startsWith(href);

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 overflow-y-auto p-4" aria-label="Morada Gestion">
      <Link href="/app" className="mb-4 block px-2">
        <GestionLogo />
      </Link>
      {NAV.map((g) => (
        <div key={g.title ?? "top"} className="mb-2">
          {g.title && (
            <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft/60">
              {g.title}
            </p>
          )}
          {g.items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              aria-current={isActivePath(i.href) ? "page" : undefined}
              className={
                "block rounded-xl px-3 py-2 text-sm font-medium transition " +
                (isActivePath(i.href)
                  ? "bg-brand-50 font-semibold text-brand-800"
                  : "text-ink-soft hover:bg-sand-50 hover:text-ink")
              }
            >
              {i.label}
            </Link>
          ))}
        </div>
      ))}
      <div className="mt-auto border-t border-sand-100 pt-3 text-[11px] text-ink-soft/60">
        <p className="px-3">Écosystème Morada</p>
        <div className="flex gap-3 px-3 pt-1">
          <a href="https://morada.lu" className="hover:text-brand-700">Morada</a>
          <a href="https://morada.lu/pro" className="hover:text-brand-700">Pro</a>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh bg-sand-50">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 border-r border-sand-100 bg-white lg:block">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-pop">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-h-dvh flex-col lg:pl-60">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-sand-100 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button
            className="rounded-lg p-2 text-ink-soft hover:bg-sand-100 lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Ouvrir le menu"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          <p className="truncate text-sm font-semibold text-ink">Cabinet Reuter</p>
          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-700">
            Démo
          </span>

          <div className="flex-1" />

          <button
            onClick={() => setPaletteOpen(true)}
            className="hidden items-center gap-2 rounded-xl border border-sand-200 bg-white px-3 py-1.5 text-sm text-ink-soft transition hover:border-brand-200 hover:text-ink sm:flex"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
              <circle cx="11" cy="11" r="7" />
              <path strokeLinecap="round" d="m20 20-3.5-3.5" />
            </svg>
            Rechercher…
            <kbd className="rounded-md border border-sand-200 bg-sand-50 px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft">
              ⌘K
            </kbd>
          </button>
          <button
            onClick={() => setPaletteOpen(true)}
            className="rounded-lg p-2 text-ink-soft hover:bg-sand-100 sm:hidden"
            aria-label="Rechercher"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
              <circle cx="11" cy="11" r="7" />
              <path strokeLinecap="round" d="m20 20-3.5-3.5" />
            </svg>
          </button>

          <QuickAddMenu items={QUICK_ADD} />
          <UserMenu email="alex@cabinet-reuter.lu" name="Alex Reuter" />
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} quickAdd={QUICK_ADD} />
    </div>
  );
}

/* -------------------------------- quick add --------------------------------- */

function QuickAddMenu({ items }: { items: { label: string; href: string }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="tactile flex items-center gap-1.5 rounded-full bg-brand-700 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-600"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" d="M12 5v14M5 12h14" />
        </svg>
        <span className="hidden sm:inline">Nouveau</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 z-40 w-48 rounded-xl border border-sand-200 bg-white p-1.5 shadow-lg">
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2 text-sm font-medium text-ink hover:bg-sand-50"
            >
              {i.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------- user menu --------------------------------- */

function UserMenu({ email, name }: { email: string; name: string }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Mon compte"
      >
        {initials}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 z-40 w-56 rounded-xl border border-sand-200 bg-white p-1.5 shadow-lg">
          <div className="border-b border-sand-100 px-3 py-2">
            <p className="truncate text-sm font-semibold text-ink">{name}</p>
            <p className="truncate text-xs text-ink-soft">{email}</p>
          </div>
          <a href="https://morada.lu" className="block rounded-lg px-3 py-2 text-sm text-ink hover:bg-sand-50">
            Mon compte Morada
          </a>
          <button className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50">
            Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ command palette ----------------------------- */

interface SearchHit {
  type: "property" | "unit" | "tenant" | "lease" | "contact";
  label: string;
  sub: string;
  href: string;
}

function searchDemo(q: string): SearchHit[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const hits: SearchHit[] = [];
  for (const p of PROPERTIES) {
    if (`${p.name} ${p.address}`.toLowerCase().includes(needle)) {
      hits.push({ type: "property", label: p.name, sub: p.address, href: `/app/biens/${p.id}` });
    }
  }
  for (const u of UNITS) {
    const p = propertyById(u.propertyId);
    if (`${u.label} ${p.name}`.toLowerCase().includes(needle)) {
      hits.push({ type: "unit", label: `${u.label} — ${p.name}`, sub: p.address, href: `/app/biens/${p.id}` });
    }
  }
  for (const c of CONTACTS) {
    if (`${c.name} ${c.email ?? ""}`.toLowerCase().includes(needle)) {
      hits.push({ type: "contact", label: c.name, sub: c.email ?? c.phone ?? "", href: `/app/contacts/${c.id}` });
    }
  }
  for (const l of LEASES) {
    const label = `${leaseUnitLabel(l)} · ${leaseTenantNames(l).join(", ")}`;
    if (label.toLowerCase().includes(needle)) {
      hits.push({
        type: "lease",
        label: leaseUnitLabel(l),
        sub: leaseTenantNames(l).join(", "),
        href: `/app/baux/${l.id}`,
      });
    }
  }
  return hits.slice(0, 12);
}

function CommandPalette({
  open,
  onClose,
  quickAdd,
}: {
  open: boolean;
  onClose: () => void;
  quickAdd: { label: string; href: string }[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 200);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const hits = searchDemo(dq);
  const navMatches = NAV.flatMap((g) => g.items).filter(
    (i) => !q.trim() || i.label.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const addMatches = quickAdd.filter(
    (i) => q.trim() && `créer ${i.label}`.toLowerCase().includes(q.trim().toLowerCase()),
  );

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  const TYPE_LABEL: Record<SearchHit["type"], string> = {
    property: "Bien",
    unit: "Unité",
    tenant: "Locataire",
    lease: "Bail",
    contact: "Contact",
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-ink/40 p-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-pop" role="dialog" aria-modal aria-label="Recherche">
        <div className="flex items-center gap-2.5 border-b border-sand-100 px-4">
          <svg className="h-4 w-4 text-ink-soft" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
            <circle cx="11" cy="11" r="7" />
            <path strokeLinecap="round" d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher un bien, un locataire, une action…"
            className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-ink-soft/50"
          />
          {q !== dq && <Spinner size={14} />}
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {hits.length > 0 && (
            <>
              <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft/60">
                Résultats
              </p>
              {hits.map((h, i) => (
                <button
                  key={`${h.href}-${i}`}
                  onClick={() => go(h.href)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-sand-50"
                >
                  <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-brand-700">
                    {TYPE_LABEL[h.type]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{h.label}</span>
                    <span className="block truncate text-xs text-ink-soft">{h.sub}</span>
                  </span>
                </button>
              ))}
            </>
          )}
          {addMatches.length > 0 && (
            <>
              <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft/60">
                Actions
              </p>
              {addMatches.map((i) => (
                <button
                  key={i.href}
                  onClick={() => go(i.href)}
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-ink hover:bg-sand-50"
                >
                  + Créer : {i.label}
                </button>
              ))}
            </>
          )}
          <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft/60">
            Navigation
          </p>
          {navMatches.map((i) => (
            <button
              key={i.href}
              onClick={() => go(i.href)}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-sand-50"
            >
              {i.label}
            </button>
          ))}
          {q.trim().length >= 2 && hits.length === 0 && (
            <p className="px-3 py-3 text-sm text-ink-soft">Aucun résultat pour « {q.trim()} ».</p>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import { useDismiss } from "@/lib/useDismiss";
import { Button, Field, InlineError, Input, Modal, Select, Textarea } from "@/components/pro/ui";
import NavigationProgress from "@/components/NavigationProgress";
import GestionLogo from "./GestionLogo";
import type { Dict } from "@/lib/i18n/fr";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n/config";
import type { SearchHit } from "@/lib/demo/search";

/** Everything the shell needs from the active demo dataset, precomputed
 *  server-side in the layout — the client bundle never ships the datasets. */
export interface ShellData {
  datasetId: "fr" | "lu";
  orgShortName: string;
  userName: string;
  userEmail: string;
  badges: { review: number; unread: number };
  searchIndex: SearchHit[];
  unitOptions: Array<{ id: string; label: string }>;
}

/* --------------------------------- nav model --------------------------------
   The immocloud workflow set (Dashboard, Workflows, Objects, Tenancies,
   Meters, Operating costs, Contacts, Rent, Finance, Banking, Messaging,
   Rental contracts, Documents) + the Luxembourg compliance modules that are
   the product's moat. Labels come from the active dictionary. */

type NavItem = { href: string; label: string; badge?: number };
type NavGroup = { title: string | null; items: NavItem[] };

function navGroups(d: Dict, badges: { review: number; unread: number }): NavGroup[] {
  return [
    { title: null, items: [{ href: "/app", label: d.nav.home }] },
    {
      title: d.nav.groupGestion,
      items: [
        { href: "/app/workflows", label: d.nav.workflows },
        { href: "/app/biens", label: d.nav.properties },
        { href: "/app/baux", label: d.nav.leases },
        { href: "/app/compteurs", label: d.nav.meters },
        { href: "/app/charges", label: d.nav.charges },
      ],
    },
    {
      title: d.nav.groupRelations,
      items: [
        { href: "/app/contacts", label: d.nav.contacts },
        { href: "/app/messages", label: d.nav.messages, badge: badges.unread || undefined },
      ],
    },
    {
      title: d.nav.groupFinances,
      items: [
        { href: "/app/loyers", label: d.nav.rent },
        { href: "/app/finance", label: d.nav.finance },
        { href: "/app/banque", label: d.nav.banking, badge: badges.review || undefined },
      ],
    },
    {
      title: d.nav.groupContracts,
      items: [
        { href: "/app/contrats", label: d.nav.contracts },
        { href: "/app/documents", label: d.nav.documents },
      ],
    },
    {
      title: d.nav.groupLux,
      items: [
        { href: "/app/conformite", label: d.nav.compliance },
        { href: "/app/indexation", label: d.nav.indexation },
        { href: "/app/garanties", label: d.nav.deposits },
        { href: "/app/aml", label: d.nav.aml },
        { href: "/app/fiscalite", label: d.nav.tax },
      ],
    },
  ];
}

type CreateKind = "property" | "lease" | "contact" | "payment" | "ticket" | "document";

function quickAdd(d: Dict): Array<{ kind: CreateKind; label: string }> {
  return [
    { kind: "property", label: d.shell.quickAddProperty },
    { kind: "lease", label: d.shell.quickAddLease },
    { kind: "contact", label: d.shell.quickAddContact },
    { kind: "payment", label: d.shell.quickAddPayment },
    { kind: "ticket", label: d.shell.quickAddTicket },
    { kind: "document", label: d.shell.quickAddDocument },
  ];
}

/* ----------------------------------- shell ---------------------------------- */

export default function GestionShell({
  locale,
  dict,
  shell,
  children,
}: {
  locale: Locale;
  dict: Dict;
  shell: ShellData;
  children: React.ReactNode;
}) {
  const d = dict;
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const reduced = useReducedMotion();

  const NAV = useMemo(
    () => navGroups(d, shell.badges),
    [d, shell.badges],
  );
  const QUICK_ADD = useMemo(() => quickAdd(d), [d]);

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
            <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              {g.title}
            </p>
          )}
          {g.items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              aria-current={isActivePath(i.href) ? "page" : undefined}
              className={
                "flex items-center justify-between rounded-xl px-3 py-2 text-sm font-medium transition max-sm:min-h-11 " +
                (isActivePath(i.href)
                  ? "bg-brand-50 font-semibold text-brand-800"
                  : "text-ink-soft hover:bg-sand-50 hover:text-ink")
              }
            >
              {i.label}
              {i.badge && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-600 px-1.5 text-[10px] font-bold tabular-nums text-white">
                  {i.badge}
                </span>
              )}
            </Link>
          ))}
        </div>
      ))}
      <div className="mt-auto border-t border-sand-100 pt-3">
        <DatasetSwitch d={d} datasetId={shell.datasetId} />
        <div className="pt-3 text-[11px] text-ink-soft">
          <p className="px-3">{d.nav.ecosystem}</p>
          <div className="flex gap-3 px-3 pt-1">
            <a href="https://morada.lu" className="hover:text-brand-700">Morada</a>
            <a href="https://morada.lu/pro" className="hover:text-brand-700">Pro</a>
          </div>
        </div>
      </div>
    </nav>
  );

  return (
    <MotionConfig reducedMotion="user">
      <a
        href="#main"
        className="sr-only z-[80] rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        {d.common.skipToContent}
      </a>
      <NavigationProgress />
      <div className="min-h-dvh bg-sand-50">
        {/* Desktop sidebar */}
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 border-r border-sand-100 bg-white lg:block">
          {sidebar}
        </aside>

        {/* Mobile drawer — a real dialog: Escape closes, focus contained,
            enters and exits along the same path. */}
        <MobileDrawer open={mobileOpen} onClose={() => setMobileOpen(false)} label={d.shell.menuLabel}>
          {sidebar}
        </MobileDrawer>

        <div className="flex min-h-dvh flex-col lg:pl-60">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-sand-100 bg-white/90 px-4 backdrop-blur sm:gap-3 sm:px-6">
            <button
              className="-ml-2 flex h-11 w-11 items-center justify-center rounded-lg text-ink-soft hover:bg-sand-100 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label={d.common.openMenu}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>

            <p className="truncate text-sm font-semibold text-ink">{shell.orgShortName}</p>
            <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-700">
              {d.common.demo}
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
              {d.common.search}
              <kbd className="rounded-md border border-sand-200 bg-sand-50 px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft">
                ⌘K
              </kbd>
            </button>
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-soft hover:bg-sand-100 sm:hidden"
              aria-label={d.shell.searchAria}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                <circle cx="11" cy="11" r="7" />
                <path strokeLinecap="round" d="m20 20-3.5-3.5" />
              </svg>
            </button>

            <LanguageMenu locale={locale} label={d.common.language} />
            <QuickAddMenu
              items={QUICK_ADD}
              label={d.shell.newButton}
              onPick={(k) => (k === "property" ? router.push("/app/biens/nouveau") : setCreateKind(k))}
            />
            <UserMenu email={shell.userEmail} name={shell.userName} d={d} />
          </header>

          <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
        </div>

        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          d={d}
          nav={NAV}
          quickAdd={QUICK_ADD}
          index={shell.searchIndex}
          onCreate={(k) => {
            setPaletteOpen(false);
            if (k === "property") router.push("/app/biens/nouveau");
            else setCreateKind(k);
          }}
          reduced={Boolean(reduced)}
        />

        <CreateDialog
          kind={createKind}
          onClose={() => setCreateKind(null)}
          d={d}
          unitOptions={shell.unitOptions}
        />
      </div>
    </MotionConfig>
  );
}

/* ------------------------------- mobile drawer ------------------------------ */

function MobileDrawer({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const ref = useDismiss<HTMLDivElement>(open, onClose);
  const reduced = useReducedMotion();
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <motion.div
            className="absolute inset-0 bg-ink/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            aria-hidden
          />
          <motion.aside
            ref={ref}
            role="dialog"
            aria-modal
            aria-label={label}
            className="absolute inset-y-0 left-0 w-72 bg-white shadow-pop"
            initial={reduced ? { opacity: 0 } : { x: -288 }}
            animate={reduced ? { opacity: 1 } : { x: 0 }}
            exit={reduced ? { opacity: 0 } : { x: -288 }}
            transition={reduced ? { duration: 0.15 } : { type: "spring", stiffness: 380, damping: 32 }}
          >
            <button
              onClick={onClose}
              className="absolute right-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-lg text-ink-soft hover:bg-sand-100"
              aria-label={label}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
            {children}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------ dropdown shell ------------------------------ */

function Dropdown({
  open,
  children,
  widthClass = "w-48",
}: {
  open: boolean;
  children: React.ReactNode;
  widthClass?: string;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={`absolute right-0 top-11 z-40 origin-top-right rounded-xl border border-sand-200 bg-white p-1.5 shadow-lg ${widthClass}`}
          initial={{ opacity: 0, scale: 0.96, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -4 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------ language menu ------------------------------- */

function LanguageMenu({ locale, label }: { locale: Locale; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const router = useRouter();

  const pick = (l: Locale) => {
    document.cookie = `morada_locale=${l}; path=/; max-age=31536000; samesite=lax`;
    setOpen(false);
    router.refresh();
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 items-center gap-1.5 rounded-xl px-2.5 text-sm font-semibold text-ink-soft transition hover:bg-sand-100 hover:text-ink"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
        </svg>
        <span className="uppercase">{locale}</span>
      </button>
      <Dropdown open={open} widthClass="w-44">
        {LOCALES.map((l) => (
          <button
            key={l}
            onClick={() => pick(l)}
            aria-current={l === locale ? "true" : undefined}
            className={
              "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium hover:bg-sand-50 " +
              (l === locale ? "text-brand-800" : "text-ink")
            }
          >
            {LOCALE_LABELS[l]}
            {l === locale && (
              <svg className="h-4 w-4 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
              </svg>
            )}
          </button>
        ))}
      </Dropdown>
    </div>
  );
}

/* -------------------------------- quick add --------------------------------- */

function QuickAddMenu({
  items,
  label,
  onPick,
}: {
  items: Array<{ kind: CreateKind; label: string }>;
  label: string;
  onPick: (k: CreateKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="tactile flex min-h-9 items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 max-sm:min-h-11"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" d="M12 5v14M5 12h14" />
        </svg>
        <span className="hidden sm:inline">{label}</span>
      </button>
      <Dropdown open={open}>
        {items.map((i) => (
          <button
            key={i.kind}
            onClick={() => {
              setOpen(false);
              onPick(i.kind);
            }}
            className="block w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-ink hover:bg-sand-50"
          >
            {i.label}
          </button>
        ))}
      </Dropdown>
    </div>
  );
}

/* -------------------------------- user menu --------------------------------- */

function UserMenu({ email, name, d }: { email: string; name: string; d: Dict }) {
  const [open, setOpen] = useState(false);
  const [signedOutNote, setSignedOutNote] = useState(false);
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
        className="flex h-11 w-11 items-center justify-center rounded-full"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={d.shell.account}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">
          {initials}
        </span>
      </button>
      <Dropdown open={open} widthClass="w-56">
        <div className="border-b border-sand-100 px-3 py-2">
          <p className="truncate text-sm font-semibold text-ink">{name}</p>
          <p className="truncate text-xs text-ink-soft">{email}</p>
        </div>
        <a href="https://morada.lu" className="block rounded-lg px-3 py-2 text-sm text-ink hover:bg-sand-50">
          {d.shell.moradaAccount}
        </a>
        {signedOutNote ? (
          <p role="status" className="rounded-lg px-3 py-2 text-xs font-semibold text-emerald-800">
            {d.common.demoNotice}
          </p>
        ) : (
          <button
            onClick={() => setSignedOutNote(true)}
            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"
          >
            {d.shell.signOut}
          </button>
        )}
      </Dropdown>
    </div>
  );
}

/* ----------------------------- dataset switch ------------------------------- */

function DatasetSwitch({ d, datasetId }: { d: Dict; datasetId: "fr" | "lu" }) {
  const router = useRouter();
  const pick = (id: "fr" | "lu") => {
    if (id === datasetId) return;
    document.cookie = `morada_dataset=${id}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
  return (
    <div className="px-3">
      <div className="flex items-center gap-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
          {d.shell.datasetTitle}
        </p>
        <span className="rounded-full bg-accent-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent-700">
          {d.shell.datasetBeta}
        </span>
      </div>
      <div
        role="radiogroup"
        aria-label={d.shell.datasetAria}
        className="mt-2 grid grid-cols-2 gap-1 rounded-xl border border-sand-200 bg-sand-50 p-1"
      >
        {(["fr", "lu"] as const).map((id) => (
          <button
            key={id}
            role="radio"
            aria-checked={id === datasetId}
            onClick={() => pick(id)}
            title={id === "fr" ? d.shell.datasetFr : d.shell.datasetLu}
            className={
              "rounded-lg px-2 py-1.5 text-xs font-semibold transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] " +
              (id === datasetId ? "bg-white text-brand-800 shadow-sm" : "text-ink-soft hover:text-ink")
            }
          >
            {id.toUpperCase()}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-ink-soft">
        {datasetId === "fr" ? d.shell.datasetFr : d.shell.datasetLu}
      </p>
    </div>
  );
}

/* ------------------------------ command palette ----------------------------- */

function searchDemo(q: string, index: SearchHit[]): SearchHit[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  return index.filter((h) => h.hay.includes(needle)).slice(0, 12);
}

type PaletteItem =
  | { kind: "hit"; hit: SearchHit }
  | { kind: "create"; createKind: CreateKind; label: string }
  | { kind: "nav"; href: string; label: string };

function CommandPalette({
  open,
  onClose,
  d,
  nav,
  quickAdd,
  index,
  onCreate,
  reduced,
}: {
  open: boolean;
  onClose: () => void;
  d: Dict;
  nav: NavGroup[];
  quickAdd: Array<{ kind: CreateKind; label: string }>;
  index: SearchHit[];
  onCreate: (k: CreateKind) => void;
  reduced: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      const previouslyFocused = document.activeElement as HTMLElement | null;
      setTimeout(() => inputRef.current?.focus(), 30);
      return () => previouslyFocused?.focus();
    }
  }, [open]);

  const hits = searchDemo(q, index);
  const needle = q.trim().toLowerCase();
  const createMatches = needle
    ? quickAdd.filter((i) => `${d.shell.createPrefix} ${i.label}`.toLowerCase().includes(needle) || i.label.toLowerCase().includes(needle))
    : [];
  const navMatches = nav
    .flatMap((g) => g.items)
    .filter((i) => !needle || i.label.toLowerCase().includes(needle));

  const items: PaletteItem[] = [
    ...hits.map((hit): PaletteItem => ({ kind: "hit", hit })),
    ...createMatches.map((c): PaletteItem => ({ kind: "create", createKind: c.kind, label: c.label })),
    ...navMatches.map((n): PaletteItem => ({ kind: "nav", href: n.href, label: n.label })),
  ];
  const clampedActive = Math.min(active, Math.max(0, items.length - 1));

  const activate = (item: PaletteItem) => {
    if (item.kind === "hit") {
      onClose();
      router.push(item.hit.href);
    } else if (item.kind === "nav") {
      onClose();
      router.push(item.href);
    } else {
      onCreate(item.createKind);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const TYPE_LABEL: Record<SearchHit["type"], string> = {
    property: d.shell.typeProperty,
    unit: d.shell.typeUnit,
    tenant: d.shell.typeTenant,
    lease: d.shell.typeLease,
    contact: d.shell.typeContact,
  };

  let cursor = -1;
  const rowClass = (isActive: boolean) =>
    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left " +
    (isActive ? "bg-sand-100" : "hover:bg-sand-50");

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-ink/40 p-4 pt-[12vh] backdrop-blur-sm"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-pop"
        role="dialog"
        aria-modal
        aria-label={d.shell.searchAria}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
        transition={reduced ? { duration: 0.15 } : { type: "spring", stiffness: 380, damping: 32 }}
      >
        <div className="flex items-center gap-2.5 border-b border-sand-100 px-4">
          <svg className="h-4 w-4 text-ink-soft" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path strokeLinecap="round" d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items.length > 0 ? `palette-item-${clampedActive}` : undefined}
            aria-label={d.shell.searchAria}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => (a + 1) % Math.max(1, items.length));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => (a - 1 + Math.max(1, items.length)) % Math.max(1, items.length));
              } else if (e.key === "Home") {
                e.preventDefault();
                setActive(0);
              } else if (e.key === "End") {
                e.preventDefault();
                setActive(Math.max(0, items.length - 1));
              } else if (e.key === "Enter" && items[clampedActive]) {
                e.preventDefault();
                activate(items[clampedActive]);
              }
            }}
            placeholder={d.shell.searchPlaceholder}
            className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-ink-soft"
          />
        </div>
        <div id="palette-list" role="listbox" ref={listRef} className="max-h-[50dvh] overflow-y-auto p-2">
          {hits.length > 0 && (
            <>
              <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                {d.shell.results}
              </p>
              {hits.map((h) => {
                cursor += 1;
                const idx = cursor;
                return (
                  <button
                    key={`${h.href}-${idx}`}
                    id={`palette-item-${idx}`}
                    role="option"
                    aria-selected={idx === clampedActive}
                    onClick={() => activate({ kind: "hit", hit: h })}
                    onMouseMove={() => setActive(idx)}
                    className={rowClass(idx === clampedActive)}
                  >
                    <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-brand-700">
                      {TYPE_LABEL[h.type]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{h.label}</span>
                      <span className="block truncate text-xs text-ink-soft">{h.sub}</span>
                    </span>
                  </button>
                );
              })}
            </>
          )}
          {createMatches.length > 0 && (
            <>
              <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                {d.shell.actions}
              </p>
              {createMatches.map((c) => {
                cursor += 1;
                const idx = cursor;
                return (
                  <button
                    key={c.kind}
                    id={`palette-item-${idx}`}
                    role="option"
                    aria-selected={idx === clampedActive}
                    onClick={() => activate({ kind: "create", createKind: c.kind, label: c.label })}
                    onMouseMove={() => setActive(idx)}
                    className={rowClass(idx === clampedActive) + " text-sm font-medium text-ink"}
                  >
                    + {d.shell.createPrefix} {c.label}
                  </button>
                );
              })}
            </>
          )}
          <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
            {d.shell.navigation}
          </p>
          {navMatches.map((i) => {
            cursor += 1;
            const idx = cursor;
            return (
              <button
                key={i.href}
                id={`palette-item-${idx}`}
                role="option"
                aria-selected={idx === clampedActive}
                onClick={() => activate({ kind: "nav", href: i.href, label: i.label })}
                onMouseMove={() => setActive(idx)}
                className={rowClass(idx === clampedActive) + " text-sm text-ink"}
              >
                {i.label}
              </button>
            );
          })}
          {needle.length >= 2 && hits.length === 0 && (
            <p className="px-3 py-3 text-sm text-ink-soft">{d.shell.noResultsFor.replace("{q}", q.trim())}</p>
          )}
        </div>
      </motion.div>
    </div>
  );
}

/* ------------------------------ create dialog ------------------------------- */

function CreateDialog({
  kind,
  onClose,
  d,
  unitOptions,
}: {
  kind: CreateKind | null;
  onClose: () => void;
  d: Dict;
  unitOptions: Array<{ id: string; label: string }>;
}) {
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => setSubmitted(false), [kind]);

  const labels: Record<CreateKind, string> = {
    property: d.shell.quickAddProperty,
    lease: d.shell.quickAddLease,
    contact: d.shell.quickAddContact,
    payment: d.shell.quickAddPayment,
    ticket: d.shell.quickAddTicket,
    document: d.shell.quickAddDocument,
  };

  return (
    <Modal
      open={kind !== null}
      onClose={onClose}
      title={kind ? d.shell.createDialogTitle.replace("{what}", labels[kind]) : ""}
      closeLabel={d.common.close}
    >
      {kind && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
          }}
        >
          {(kind === "property" || kind === "contact") && (
            <>
              <Field label={d.shell.fieldName}>
                <Input required maxLength={120} />
              </Field>
              <Field label={d.shell.fieldAddress}>
                <Input maxLength={200} />
              </Field>
              {kind === "contact" && (
                <>
                  <Field label={d.shell.fieldEmail}>
                    <Input type="email" autoComplete="email" />
                  </Field>
                  <Field label={d.shell.fieldPhone}>
                    <Input type="tel" autoComplete="tel" />
                  </Field>
                </>
              )}
            </>
          )}
          {(kind === "lease" || kind === "payment" || kind === "ticket") && (
            <>
              <Field label={d.shell.fieldUnit}>
                <Select defaultValue={unitOptions[0]?.id}>
                  {unitOptions.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {kind !== "ticket" && (
                <Field label={d.shell.fieldAmount}>
                  <Input inputMode="decimal" placeholder="1 850,00" />
                </Field>
              )}
              {kind === "ticket" && (
                <Field label={d.shell.fieldNote}>
                  <Textarea maxLength={500} />
                </Field>
              )}
            </>
          )}
          {kind === "document" && (
            <Field label={d.shell.fieldLabel}>
              <Input required maxLength={160} />
            </Field>
          )}

          {submitted ? (
            <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
              {d.common.demoCreateNotice}
            </p>
          ) : (
            <InlineError>{null}</InlineError>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {d.common.cancel}
            </Button>
            <Button type="submit">{d.shell.submitCreate}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

"use client";

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import { useDismiss } from "@/lib/useDismiss";
import { Button, Field, InlineError, Input, Modal, Select } from "@/components/pro/ui";
import { Icon, type IconName } from "@/components/pro/icons";
import NavigationProgress from "@/components/NavigationProgress";
import KeepFresh from "@/components/KeepFresh";
import GestionLogo from "./GestionLogo";
import SidebarNav from "./SidebarNav";
import MobileDrawer from "./MobileDrawer";
import ScrollHeader from "./ScrollHeader";
import GettingStarted from "./GettingStarted";
import SetupTour, { ArrivalScript } from "./onboarding/SetupTour";
import type { ShellSetup } from "@/lib/gestion/setup";
import DegradedBanner from "./DegradedBanner";
import { BillingBanner, LockWatch, TrialChip, type ShellBilling } from "./BillingShell";
import type { Dict } from "@/lib/i18n/fr";
import { LOCALES, LOCALE_LABELS, fmt, type Locale } from "@/lib/i18n/config";
import type { SearchHit } from "@/lib/demo/search";
import type { DatasetId } from "@/lib/demo";
import { CREATE_EVENT } from "@/components/gestion/HeroCreate";
import { ApiProblemNote } from "@/components/gestion/ApiErrors";
import DateField from "@/components/gestion/DateField";
import { networkProblem, readApiProblem, type ApiProblem } from "@/lib/api-errors";
import { isZeroAmount, parseEuroInput } from "@/lib/gestion/euros";
import { todayISO } from "@/lib/clock";
import { inSection } from "@/lib/nav-match";

/** Everything the shell needs from the active demo dataset, precomputed
 *  server-side in the layout — the client bundle never ships the datasets. */
export interface ShellData {
  datasetId: DatasetId;
  /** The sample cabinet on screen, or null when this is the account's own data. */
  sampleCabinet: string | null;
  /** True once a real Morada session is driving the screen. */
  signedIn: boolean;
  /** The account is a tenant somewhere: the tenant space is one click away. */
  tenant: boolean;
  /** "owner" hides the cabinet-only surfaces (AML) everywhere. */
  workspaceKind: string;
  orgShortName: string;
  /** Part of the account's data could not be read: the screen may be incomplete. */
  degraded?: boolean;
  userName: string;
  userEmail: string;
  badges: { review: number; unread: number };
  unitOptions: Array<{ id: string; label: string }>;
  leaseOptions: Array<{ id: string; label: string }>;
  /** The quick "Bail" sheet: lots that can be let and have no lease in force, contacts recorded as tenants. */
  vacantUnitOptions: Array<{ id: string; label: string }>;
  tenantOptions: Array<{ id: string; label: string }>;
  /** The guided setup: what the account's own rows attest, where each step starts, and whether the tour may play. */
  progress: ShellSetup;
  /** The workspace's subscription, when subscriptions are on and the data is its own. */
  billing: ShellBilling | null;
  /** The workspace on screen and every workspace the account may open: more than one shows the switch in the rail. */
  workspaceId?: string;
  workspaces?: Array<{ id: string; name: string }>;
}

/* --------------------------------- nav model --------------------------------
   The sidebar names the main sections; each one folds its sub-sections
   directly underneath. The whole group row toggles disclosure; everyday
   sections are open on arrival, and the rail stays identical on every
   screen. A section lights up for every path inside it, so /app/banque
   highlights Finances and /app/baux/b-12 highlights Patrimoine. */

type NavChild = { href: string; label: string; badge?: number };
type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  badge?: number;
  children?: NavChild[];
  /** Paths that belong to this section without being listed in it. The
   *  rental dossier, the meter sheet and the deposit ledger now open from
   *  the property they concern, so they light Patrimoine up without ever
   *  taking a line in the rail. */
  also?: string[];
};

function destinations(d: Dict, badges: { review: number; unread: number }, workspaceKind: string, sample: boolean): NavItem[] {
  // AML/KYC is a cabinet obligation: on an owner-kind workspace the entry
  // simply does not exist. The screen has no backend on an account's own
  // data yet, so the rail lists it on a sample cabinet only: nobody is led
  // to a screen with nothing behind it.
  const cabinet = workspaceKind !== "owner" && sample;
  // One flat list, as a landlord names things: the places of every day
  // first, each a single line; only what really has several rooms (the
  // books, the documents, the settings) opens on sub-entries. A bail, a
  // compteur, une garantie, un EDL, une assurance and l'indexation belong
  // to a property and open from it: the routes stay, the rail does not
  // list them.
  return [
    { href: "/app", label: d.nav.home, icon: "dashboard" },
    {
      href: "/app/biens",
      label: d.hubs.portfolio,
      icon: "properties",
      also: ["/app/baux", "/app/compteurs", "/app/indexation", "/app/garanties", "/app/edl", "/app/assurances", "/app/workflows"],
    },
    { href: "/app/loyers", label: d.nav.rents, icon: "key" },
    {
      href: "/app/finance",
      label: d.nav.finances,
      also: ["/app/financement"],
      icon: "euro",
      badge: badges.review || undefined,
      children: [
        { href: "/app/finance", label: d.nav.cash },
        { href: "/app/banque", label: d.hubs.banking, badge: badges.review || undefined },
        { href: "/app/charges", label: d.hubs.statements },
        { href: "/app/rapports", label: d.nav.reportsNav },
        { href: "/app/fiscalite", label: d.hubs.reports },
        { href: "/app/emprunts", label: d.nav.mortgages },
        { href: "/app/acquisitions", label: d.nav.acquisitions },
      ],
    },
    { href: "/app/interventions", label: d.hubs.interventions, icon: "tasks" },
    { href: "/app/messages", label: d.hubs.messages, icon: "messages", badge: badges.unread || undefined },
    { href: "/app/contacts", label: d.hubs.people, icon: "contacts" },
    {
      href: "/app/documents",
      label: d.nav.documents,
      icon: "documents",
      children: [
        { href: "/app/documents", label: d.hubs.library },
        { href: "/app/contrats", label: d.hubs.contracts },
      ],
    },
    { href: "/app/calculateurs", label: d.nav.calculatorsNav, icon: "percent" },
    cabinet
      ? {
          href: "/app/conformite",
          label: d.dash.vigilanceTitle,
          icon: "shield-check",
          children: [
            { href: "/app/conformite", label: d.hubs.compliance },
            { href: "/app/aml", label: d.hubs.aml },
          ],
        }
      : { href: "/app/conformite", label: d.dash.vigilanceTitle, icon: "shield-check" },
    {
      href: "/app/reglages",
      label: d.nav.settings,
      icon: "settings",
      also: ["/app/compte"],
      children: [
        { href: "/app/reglages", label: d.hubs.general },
        { href: "/app/abonnement", label: d.hubs.subscription },
        { href: "/app/utilisateurs", label: d.hubs.users },
        { href: "/app/integrations", label: d.hubs.integrations },
      ],
    },
  ];
}

/** Every path prefix that lights a section up. */
function matchesOf(i: NavItem): string[] {
  return [...(i.children?.map((c) => c.href) ?? [i.href]), ...(i.also ?? [])];
}

/** A path is inside a section when it is one of its addresses or sits under one: `/app/compteurs` is not inside `/app/compte`. */
function within(pathname: string, i: NavItem): boolean {
  return inSection(pathname, matchesOf(i));
}

/** Everything ⌘K can route to: home, every sub-section, Workflows, and the
 *  registers that moved into the property context. Simplifying the rail took
 *  nothing off the map — these still answer to their name in the palette. */
function navigable(nav: NavItem[], d: Dict): Array<{ href: string; label: string }> {
  const seen = new Set<string>();
  const out: Array<{ href: string; label: string }> = [];
  const add = (href: string, label: string) => {
    if (seen.has(href)) return;
    seen.add(href);
    out.push({ href, label });
  };
  for (const i of nav) {
    for (const entry of i.children ?? [{ href: i.href, label: i.label }]) add(entry.href, entry.label);
  }
  add("/app/workflows", d.nav.workflows);
  add("/app/baux", d.hubs.leases);
  add("/app/compteurs", d.hubs.meters);
  add("/app/indexation", d.hubs.indexation);
  add("/app/garanties", d.hubs.deposits);
  add("/app/edl", d.hubs.edl);
  add("/app/assurances", d.hubs.assurances);
  return out;
}

/** How long the palette keeps the search corpus before asking for it again. */
const SEARCH_INDEX_TTL = 60_000;

type CreateKind = "property" | "lease" | "contact" | "payment" | "ticket";
const QUICK_KINDS = new Set<string>(["lease", "contact", "payment", "ticket"]);

function quickAdd(d: Dict): Array<{ kind: CreateKind; label: string }> {
  return [
    { kind: "property", label: d.shell.quickAddProperty },
    { kind: "lease", label: d.shell.quickAddLease },
    { kind: "contact", label: d.shell.quickAddContact },
    { kind: "payment", label: d.shell.quickAddPayment },
    { kind: "ticket", label: d.shell.quickAddTicket },
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
  // The search corpus comes when the palette first opens, and again after a
  // minute: no page carries it, no refresh re-sends it.
  const [searchIndex, setSearchIndex] = useState<SearchHit[]>([]);
  const searchIndexAt = useRef(0);
  useEffect(() => {
    if (!paletteOpen || Date.now() - searchIndexAt.current < SEARCH_INDEX_TTL) return;
    let live = true;
    fetch("/api/recherche", { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? (res.json() as Promise<SearchHit[]>) : null))
      .then((hits) => {
        if (!live || !hits) return;
        setSearchIndex(hits);
        searchIndexAt.current = Date.now();
      })
      .catch(() => null);
    return () => {
      live = false;
    };
  }, [paletteOpen]);

  // A page restored from the browser's back-forward cache is a snapshot of
  // the screen as it was, not of the account as it is: Safari restores it
  // even with no-store. Re-render from the server so a property created
  // since, or a tenant added since, is on the screen the owner comes back to.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) router.refresh();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [router]);
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  // A screen's own action row (Hero.tsx) opens the same creation sheets as "+ Nouveau".
  useEffect(() => {
    const open = (e: Event) => {
      const kind = (e as CustomEvent<string>).detail as CreateKind;
      if (kind === "property") router.push("/app/biens/nouveau");
      else if (QUICK_KINDS.has(kind)) setCreateKind(kind);
    };
    window.addEventListener(CREATE_EVENT, open);
    return () => window.removeEventListener(CREATE_EVENT, open);
  }, [router]);
  const reduced = useReducedMotion();

  const NAV = useMemo(
    () => destinations(d, shell.badges, shell.workspaceKind, shell.sampleCabinet !== null),
    [d, shell.badges, shell.workspaceKind, shell.sampleCabinet],
  );
  const NAVIGABLE = useMemo(() => navigable(NAV, d), [NAV, d]);

  // The rail opens flat; a group shows its rooms once the person is in it or
  // opens it. Explicit choices last for this visit.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const active = NAV.find(
      (i) => i.children && within(pathname, i),
    );
    if (active) setExpanded((prev) => (prev[active.href] ? prev : { ...prev, [active.href]: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  const real = shell.datasetId === "real";
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

  const sidebar = (
    // Two zones: the sections at the top, each folding its sub-sections;
    // the ecosystem links stay below. On short landscape
    // screens the entire drawer scrolls so destinations retain enough room.
    <div className="crm-sidebar-inner flex h-full flex-col">
    <nav className="crm-navigation flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain touch-pan-y select-none [-webkit-touch-callout:none]" aria-label="Morada Gestion">
      {/* The CRM logo always returns to the management dashboard. */}
      <Link
        href="/app"
        className="crm-logo block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        <GestionLogo />
      </Link>
      {/* The role is named only where there is a second one to tell it from; the workspace becomes a switch only where there is another to open. */}
      <WorkspaceBlock
        name={shell.orgShortName}
        role={shell.tenant ? d.shell.roleOwner : null}
        currentId={shell.workspaceId ?? ""}
        others={shell.sampleCabinet ? [] : (shell.workspaces ?? [])}
        labels={{ switch: d.shell.switchSpace, current: d.access.currentSpace, failed: d.access.switchFailed }}
      />
      <SidebarNav items={NAV} pathname={pathname} expanded={expanded} onNavigate={() => setMobileOpen(false)}
        onToggle={(href) => setExpanded((prev) => ({ ...prev, [href]: !prev[href] }))} />
    </nav>
    {shell.tenant && (
    <div className="crm-sidebar-footer shrink-0 border-t border-sand-100 px-3 pb-[max(0.75rem,var(--safe-bottom))] pt-2 xl:hidden">
      {/* The role switch lives here below `xl`, and in the toolbar above: the
          same two segments, one thumb's size each, so the tenant space is
          as reachable from a phone as from a laptop. */}
        <nav aria-label={d.shell.roleAria} className="mb-2 flex gap-1 rounded-xl border border-sand-200 bg-sand-50 p-1 select-none [-webkit-touch-callout:none] xl:hidden">
          <span aria-current="true" className="flex min-h-10 flex-1 items-center justify-center rounded-lg bg-white px-3 text-xs font-semibold text-brand-800 shadow-sm">
            {d.shell.roleOwner}
          </span>
          <Link
            href="/locataire"
            className="tactile flex min-h-10 flex-1 items-center justify-center rounded-lg px-3 text-xs font-semibold text-ink-soft hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600"
          >
            {d.shell.roleTenant}
          </Link>
        </nav>
    </div>
    )}
    </div>
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
      <KeepFresh />
      <div className="crm-shell min-h-dvh">
        {shell.progress.guide && <ArrivalScript />}
        {/* Desktop sidebar */}
        <aside className="crm-sidebar chrome-material fixed z-40 hidden lg:block">
          {sidebar}
        </aside>

        {/* Mobile drawer — a real dialog: Escape closes, focus contained,
            enters and exits along the same path. */}
        <MobileDrawer open={mobileOpen} onClose={() => setMobileOpen(false)} label={d.shell.menuLabel} closeLabel={d.common.close}>
          {sidebar}
        </MobileDrawer>

        <div className="crm-workarea flex min-h-dvh min-w-0 flex-col">
          {/* A conversation filling a phone's screen (Messages, `html[data-phone-chat]`)
              is the whole screen: the bar and the sample line step aside with the
              rest of the chrome, and the conversation's own header takes the top. */}
          <ScrollHeader
            className="crm-toolbar chrome-material sticky top-0 z-30 flex h-(--bar-h) items-center gap-2 border-b border-transparent bg-white px-safe-4 pt-(--safe-top) transition-[border-color,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] supports-[backdrop-filter]:bg-white/85 supports-[backdrop-filter]:backdrop-blur-xl supports-[backdrop-filter]:backdrop-saturate-150 max-lg:[html[data-phone-chat]_&]:hidden sm:gap-3 sm:px-safe-6"
            elevated="border-sand-100 shadow-[0_1px_10px_rgba(31,41,36,0.05)]"
          >
            <button
              className="-ml-2 flex h-11 w-11 items-center justify-center rounded-lg text-ink-soft hover:bg-sand-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label={d.common.openMenu}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>

            <p className="crm-location hidden truncate text-sm font-medium text-ink md:block">{NAV.find((item) => item.href === "/app" ? pathname === "/app" : within(pathname, item))?.label ?? d.nav.home}</p>
            {/* The badge marks sample data, so it must not sit next to a real
                workspace name. */}
            {shell.sampleCabinet && (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-800">
                {d.common.demo}
              </span>
            )}
            {/* The trial's days, on the account's own data only; the banner below says the rest on a phone. */}
            {shell.billing && (
              <span className="max-sm:hidden">
                <TrialChip billing={shell.billing} d={d} />
              </span>
            )}

            {/* One account, two roles: the owner space is this one, the
                tenant space is /locataire. Switching is a navigation, never a
                second sign-in. */}
            {shell.tenant && (
              <nav
                aria-label={d.shell.roleAria}
                className="crm-role-switch ml-1 hidden gap-1 rounded-full bg-sand-100 p-1 xl:flex"
              >
                <span aria-current="true" className="rounded-lg bg-white px-3 py-1 text-xs font-semibold text-brand-800 shadow-sm">
                  {d.shell.roleOwner}
                </span>
                <Link
                  href="/locataire"
                  className="rounded-lg px-3 py-1 text-xs font-semibold text-ink-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                >
                  {d.shell.roleTenant}
                </Link>
              </nav>
            )}

            <div className="flex-1" />

            <button
              onClick={() => setPaletteOpen(true)}
              className="crm-search hidden items-center gap-2 rounded-full border border-sand-200 bg-white px-3 py-1.5 text-sm text-ink-soft transition hover:border-brand-200 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:flex"
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
              className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-soft hover:bg-sand-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:hidden"
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
            <UserMenu email={shell.userEmail} name={shell.userName} d={d} signedIn={shell.signedIn} />
          </ScrollHeader>

          {/* Sample data announces itself on every screen. Nobody should ever
              have to remember which mode they left the sidebar in. */}
          {shell.sampleCabinet && (
            <div
              role="status"
              className="crm-sample-banner flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-200 bg-amber-50 px-safe-4 py-2 text-center text-xs font-semibold text-amber-900 max-lg:[html[data-phone-chat]_&]:hidden"
            >
              <span>{fmt(d.shell.sampleBanner, { cabinet: shell.sampleCabinet })}</span>
              <button
                onClick={() => {
                  document.cookie = "morada_dataset=real; path=/; max-age=31536000; samesite=lax";
                  router.refresh();
                }}
                className="inline-flex min-h-8 items-center rounded px-1 underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 max-sm:min-h-11"
              >
                {d.shell.sampleBack}
              </button>
            </div>
          )}

          {shell.degraded && <DegradedBanner text={d.shell.readDegraded} retry={d.shell.readRetry} />}

          {shell.billing && <BillingBanner billing={shell.billing} d={d} locale={locale} />}

          {/* On a phone the page ends clear of the home indicator, and of the
              floating getting-started card when the account has one. A
              conversation open over the phone's screen gets the screen whole:
              no gutter, no width limit (the card keeps the safe areas itself). */}
          <main id="main" tabIndex={-1} className={"crm-main mx-auto w-full max-w-6xl flex-1 px-safe-4 py-6 pb-[max(1.5rem,var(--safe-bottom))] max-lg:[html[data-phone-chat]_&]:max-w-none max-lg:[html[data-phone-chat]_&]:p-0 sm:px-safe-6" + (shell.sampleCabinet ? "" : " max-lg:pb-24")}>
            {/* While a setup step is open, the setup card is the first thing on Accueil. */}
            {pathname === "/app" && !shell.sampleCabinet && <GettingStarted d={d} locale={locale} setup={shell.progress} placement="home" />}
            {children}
          </main>
        </div>

        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          d={d}
          nav={NAVIGABLE}
          quickAdd={QUICK_ADD}
          index={searchIndex}
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
          onCreate={setCreateKind}
          d={d}
          real={real}
          unitOptions={shell.unitOptions}
          leaseOptions={shell.leaseOptions}
          vacantUnitOptions={shell.vacantUnitOptions}
          tenantOptions={shell.tenantOptions}
        />

        {shell.billing && <LockWatch />}

        {/* A "0% done" checklist on top of a full sample cabinet contradicts
            itself. It belongs to the real account only. */}
        {!shell.sampleCabinet && pathname !== "/app" && <GettingStarted d={d} locale={locale} setup={shell.progress} placement="float" />}
        {/* The first-run tour and its returns, on Accueil only (src/components/gestion/onboarding/SetupTour.tsx). */}
        {pathname === "/app" && shell.progress.guide && (
          <Suspense fallback={null}>
            <SetupTour d={d} setup={shell.progress} />
          </Suspense>
        )}
      </div>
    </MotionConfig>
  );
}

/* ------------------------------ workspace block ----------------------------- */

/**
 * The workspace on screen, at the head of the rail. An account that belongs
 * to several (its own and an agency's, say) opens another from here: the
 * server keeps the choice (POST /api/espace/actif, only for a workspace the
 * account may manage, checked again on every request), and the app starts
 * again on that workspace's home, since no record of one workspace exists in
 * another.
 */
function WorkspaceBlock({
  name,
  role,
  currentId,
  others,
  labels,
}: {
  name: string;
  role: string | null;
  currentId: string;
  others: Array<{ id: string; name: string }>;
  labels: { switch: string; current: string; failed: string };
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const body = (
    <>
      <span className="crm-workspace-icon"><Icon name="properties" size={19} /></span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-semibold text-ink">{name}</span>
        {role && <span className="block text-xs text-ink-soft">{role}</span>}
      </span>
    </>
  );
  if (others.length < 2) return <div className="crm-workspace">{body}</div>;
  const pick = async (id: string) => {
    if (id === currentId) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/espace/actif", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: id }) });
      if (res.status === 401) {
        window.location.assign("/connexion?next=/app");
        return;
      }
      if (res.ok) {
        window.location.assign("/app");
        return;
      }
    } catch {
      // Unreachable: said below, the workspace on screen stays.
    }
    setFailed(true);
    setBusy(false);
  };
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${labels.switch} · ${name}`}
        className="crm-workspace crm-workspace-switch tactile w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        {body}
        <Icon name="chevron-down" size={15} className="shrink-0 text-ink-soft" />
      </button>
      {open && (
        <ul aria-label={labels.switch} className="absolute inset-x-0 top-full z-40 -mt-3 rounded-2xl border border-sand-200 bg-white p-1.5 shadow-lg">
          {others.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                onClick={() => void pick(w.id)}
                disabled={busy}
                aria-current={w.id === currentId ? "true" : undefined}
                className={"flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-3 text-left text-sm font-medium hover:bg-sand-50 disabled:opacity-60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 " + (w.id === currentId ? "text-brand-800" : "text-ink")}
              >
                <span className="min-w-0 truncate">{w.name}</span>
                {w.id === currentId && (
                  <span className="shrink-0 text-brand-600">
                    <Icon name="check" size={16} />
                    <span className="sr-only">{labels.current}</span>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {failed && (
        <p role="alert" className="mt-1 px-1 text-xs leading-relaxed text-red-700">
          {labels.failed}
        </p>
      )}
    </div>
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
          className={`crm-dropdown absolute right-0 top-11 z-40 origin-top-right rounded-2xl border border-sand-200 bg-white p-1.5 shadow-lg ${widthClass}`}
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
        className="flex h-11 items-center gap-1.5 rounded-xl px-2.5 text-sm font-semibold text-ink-soft transition hover:bg-sand-100 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
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
              "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium hover:bg-sand-50 max-sm:min-h-11 " +
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
        className="tactile flex min-h-9 items-center gap-1.5 rounded-full bg-brand-700 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 max-sm:min-h-11"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden>
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
            className="quick-add-item flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-ink hover:bg-sand-50"
          >
            <Icon name={i.kind === "property" ? "properties" : i.kind === "lease" ? "contract" : i.kind === "contact" ? "contacts" : i.kind === "payment" ? "euro" : "tasks"} size={21}/>{i.label}
          </button>
        ))}
      </Dropdown>
    </div>
  );
}

/* -------------------------------- user menu --------------------------------- */

function UserMenu({
  email,
  name,
  d,
  signedIn,
}: {
  email: string;
  name: string;
  d: Dict;
  signedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [signedOutNote, setSignedOutNote] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // A real sign-out: the Supabase session is revoked and the cookie shared
  // with morada.lu is erased, so no account stays visible to the next one.
  const signOut = async () => {
    setLeaving(true);
    const { signOutEverywhere } = await import("@/lib/supabase/browser");
    await signOutEverywhere();
    window.location.assign("/connexion");
  };
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
        className="flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
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
        {/* The person's own account: what they signed up with, and its deletion. */}
        <Link href="/app/compte" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-ink hover:bg-sand-50 max-sm:flex max-sm:min-h-11 max-sm:items-center">
          {d.shell.moradaAccount}
        </Link>
        <div className="mt-1 border-t border-sand-100 pt-1">
          {!signedIn && signedOutNote ? (
            <p role="status" className="rounded-lg px-3 py-2 text-xs font-semibold text-emerald-800">
              {d.common.demoNotice}
            </p>
          ) : (
            <button
              onClick={signedIn ? signOut : () => setSignedOutNote(true)}
              disabled={leaving}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 max-sm:min-h-11"
            >
              {d.shell.signOut}
            </button>
          )}
        </div>
      </Dropdown>
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
  nav: Array<{ href: string; label: string }>;
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

  // The field takes the caret as the palette appears, in the same breath as
  // the tap that opened it: that is what makes a phone raise its keyboard.
  // The page behind holds still meanwhile.
  useLayoutEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      const previouslyFocused = document.activeElement as HTMLElement | null;
      const overflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = "hidden";
      inputRef.current?.focus({ preventScroll: true });
      return () => {
        document.documentElement.style.overflow = overflow;
        previouslyFocused?.focus();
      };
    }
  }, [open]);

  const hits = searchDemo(q, index);
  const needle = q.trim().toLowerCase();
  const createMatches = needle
    ? quickAdd.filter((i) => `${d.shell.createPrefix} ${i.label}`.toLowerCase().includes(needle) || i.label.toLowerCase().includes(needle))
    : [];
  const navMatches = nav.filter((i) => !needle || i.label.toLowerCase().includes(needle));

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
    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left max-sm:min-h-11 " +
    (isActive ? "bg-sand-100" : "hover:bg-sand-50");

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-ink/40 p-4 pt-[12svh] backdrop-blur-sm"
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
            // A phone's keyboard for a search: no capital forced on the first letter, no
            // correction of a name into a word, and a return key that opens the highlighted line.
            enterKeyHint="go"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="w-full min-w-0 bg-transparent py-3.5 text-sm outline-none placeholder:text-ink-soft max-sm:text-base pointer-coarse:text-base"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={d.common.close}
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-soft hover:bg-sand-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <Icon name="x" size={18} />
          </button>
        </div>
        <div id="palette-list" role="listbox" ref={listRef} className="max-h-[50dvh] overflow-y-auto overscroll-contain p-2">
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

/**
 * What a creation sheet cannot do without: a lease needs a lot and a
 * contact, a payment a running lease, an intervention a lot. A sheet opened
 * on an empty required list could only raise the browser's own "fill in
 * this field": it says what is missing instead, with the way to add it.
 */
function CreateBlocked({ text, href, action, onAction, onClose }: { text: string; href?: string; action: string; onAction?: () => void; onClose: () => void }) {
  const cls = "ui-button inline-flex min-h-11 items-center justify-center rounded-full bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";
  return (
    <div className="space-y-5" data-create-blocked>
      <p className="text-sm leading-relaxed text-ink">{text}</p>
      <div className="flex flex-wrap justify-end gap-2">
        {href ? <Link href={href} onClick={onClose} className={cls}>{action}</Link> : <button type="button" onClick={onAction} className={cls}>{action}</button>}
      </div>
    </div>
  );
}

export function CreateDialog({
  kind,
  onClose,
  onCreate,
  d,
  real,
  unitOptions,
  leaseOptions,
  vacantUnitOptions,
  tenantOptions,
}: {
  kind: CreateKind | null;
  onClose: () => void;
  /** Opens another creation sheet in place of this one (the contact a lease is waiting for). */
  onCreate: (kind: CreateKind) => void;
  d: Dict;
  real: boolean;
  unitOptions: Array<{ id: string; label: string }>;
  leaseOptions: Array<{ id: string; label: string }>;
  /** Lots that can be let and have no lease in force: all the "Bail" sheet offers. */
  vacantUnitOptions: Array<{ id: string; label: string }>;
  /** Contacts recorded as tenants: the only people the "Bail" sheet offers. */
  tenantOptions: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [leaseStep, setLeaseStep] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  // A refusal in words (src/lib/api-errors.ts), or a field the sheet itself finds wrong.
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  // The two days of the sheets: the product's own date field hands back an ISO day, or nothing.
  const [startDate, setStartDate] = useState("");
  const [receivedOn, setReceivedOn] = useState("");
  // A lease recorded with points the rule engine raised: the sheet stays open to say them.
  const [created, setCreated] = useState<{ id: string; issues: string[] } | null>(null);
  // The payment form's own key, drawn once per opening: the API writes a key once.
  const [paymentKey, setPaymentKey] = useState("");
  useEffect(() => {
    setLeaseStep(0);
    setSubmitted(false);
    setSaving(false);
    setProblem(null);
    setFieldError(null);
    setCreated(null);
    setStartDate(todayISO());
    setReceivedOn(todayISO());
    setPaymentKey(kind === "payment" ? (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`) : "");
  }, [kind]);

  useEffect(() => {
    if (kind !== "lease") return;
    formRef.current?.querySelector<HTMLElement>('fieldset:not([hidden]) input, fieldset:not([hidden]) select')?.focus();
  }, [kind, leaseStep]);

  const invalid = (label: string) => {
    setProblem(null);
    setFieldError(fmt(d.apiErrors.invalidField, { field: label }));
    return false;
  };
  /** What the sheet can check before the route does, so the refusal names the field. */
  const check = (v: (name: string) => string): boolean => {
    setFieldError(null);
    if (kind === "lease") {
      if (!startDate) return invalid(d.shell.fieldStartDate);
      if (parseEuroInput(v("rent")) === null) return invalid(d.shell.fieldRent);
      if (!isZeroAmount(v("charges")) && parseEuroInput(v("charges")) === null) return invalid(d.shell.fieldCharges);
    }
    if (kind === "payment") {
      if (parseEuroInput(v("amount")) === null) return invalid(d.shell.fieldAmount);
      if (!receivedOn) return invalid(d.shell.fieldReceivedOn);
    }
    return true;
  };

  // On a real account the form persists through the API, under the caller's
  // own session; the sample cabinets keep their explicitly-fake dialog.
  const submitReal = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!kind || saving) return;
    const f = new FormData(e.currentTarget);
    const v = (name: string) => String(f.get(name) ?? "");
    if (!check(v)) return;
    const endpoint: Partial<Record<CreateKind, string>> = {
      contact: "/api/contacts/create",
      lease: "/api/baux/create",
      payment: "/api/paiements/create",
      ticket: "/api/tickets/create",
    };
    const payload: Record<string, unknown> =
      kind === "contact"
        ? { name: v("name"), email: v("email"), phone: v("phone"), role: v("role") }
        : kind === "lease"
          ? {
              unitId: v("unitId"),
              tenantContactId: v("tenantContactId"),
              type: v("type"),
              startDate,
              rent: v("rent"),
              // "0" means no provision: the route reads an empty field as none.
              charges: isZeroAmount(v("charges")) ? "" : v("charges"),
              depositMonths: Number(v("depositMonths") || 2),
              depositForm: v("depositForm"),
            }
          : kind === "payment"
            ? { leaseId: v("leaseId"), amount: v("amount"), receivedOn, requestKey: v("requestKey") }
            : { unitId: v("unitId"), title: v("title") };
    setSaving(true);
    setProblem(null);
    try {
      const res = await fetch(endpoint[kind]!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        // The sheet stays as typed: a session that ended is signed in again beside it.
        setProblem(await readApiProblem(res, d.apiErrors, { keepsInput: true, fallback: d.shell.createFailed }));
        setSaving(false);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { id?: string; issues?: Array<{ message?: string }> };
      // What the rule engine raised on the lease just recorded is said, never dropped with the sheet.
      const issues = kind === "lease" ? (data.issues ?? []).map((i) => i.message ?? "").filter(Boolean) : [];
      router.refresh();
      if (issues.length > 0 && data.id) {
        setCreated({ id: data.id, issues });
        setSaving(false);
        return;
      }
      onClose();
    } catch {
      setProblem(networkProblem(d.apiErrors));
      setSaving(false);
    }
  };

  const labels: Record<CreateKind, string> = {
    property: d.shell.quickAddProperty,
    lease: d.shell.quickAddLease,
    contact: d.shell.quickAddContact,
    payment: d.shell.quickAddPayment,
    ticket: d.shell.quickAddTicket,
  };

  // The record a sheet needs before it can be filled in, if it is not there yet.
  const missing: "property" | "contact" | "lease" | null =
    kind === "lease" ? (unitOptions.length === 0 ? "property" : tenantOptions.length === 0 ? "contact" : null)
    : kind === "ticket" ? (unitOptions.length === 0 ? "property" : null)
    : kind === "payment" ? (leaseOptions.length === 0 ? (unitOptions.length === 0 ? "property" : "lease") : null)
    : null;

  return (
    <Modal
      open={kind !== null}
      onClose={onClose}
      title={kind ? d.shell.createDialogTitle.replace("{what}", labels[kind]) : ""}
      closeLabel={d.common.close}
    >
      {kind === "lease" && created && (
        <div className="space-y-4" data-lease-created={created.id}>
          <p role="status" className="rounded-xl bg-brand-50 px-4 py-3 text-sm font-medium text-brand-800">{d.shell.leaseCreated}</p>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-semibold text-amber-900">{d.location.complianceTitle}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
              {created.issues.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {d.common.close}
            </Button>
            <Button
              type="button"
              onClick={() => {
                onClose();
                router.push(`/app/baux/${created.id}`);
              }}
            >
              {d.loyers.openLease}
            </Button>
          </div>
        </div>
      )}
      {kind && !created && missing === "property" && <CreateBlocked text={d.shell.needProperty} href="/app/biens/nouveau" action={d.biens.addProperty} onClose={onClose} />}
      {kind && !created && missing === "contact" && <CreateBlocked text={d.shell.needContact} action={d.shell.needContactAction} onAction={() => onCreate("contact")} onClose={onClose} />}
      {kind && !created && missing === "lease" && <CreateBlocked text={d.shell.needLease} href="/app/biens" action={d.shell.needLeaseAction} onClose={onClose} />}
      {kind && !created && !missing && (
        <form
          ref={formRef}
          className="space-y-4 crm-create-form"
          onSubmit={(event) => {
            if (kind === "lease" && leaseStep === 0) {
              event.preventDefault();
              // The first step holds the day the lease starts: it is checked before the second opens.
              if (!startDate) invalid(d.shell.fieldStartDate);
              else {
                setFieldError(null);
                setLeaseStep(1);
              }
            } else if (real) void submitReal(event);
            else {
              event.preventDefault();
              setSubmitted(true);
            }
          }}
        >
          {kind === "contact" && (
            <>
              <div className="create-intro"><span className="crm-symbol"><Icon name="contacts" size={24} /></span><p>{d.experience.contactHint}</p></div>
              <Field label={`${d.shell.fieldName} *`}>
                <Input aria-label={d.shell.fieldName} name="name" autoComplete="off" required maxLength={120} />
              </Field>
              <Field label={d.shell.fieldRole}>
                <Select name="role" defaultValue="tenant">
                  {(["tenant", "owner", "guarantor", "artisan", "supplier", "syndic"] as const).map((r) => (
                    <option key={r} value={r}>
                      {d.status.role[r]}
                    </option>
                  ))}
                </Select>
              </Field>
              <details className="create-optional" open>
                <summary>{d.experience.contactDetails}<span>{d.experience.optional}</span><Icon name="chevron-down" size={16}/></summary>
                <div className="space-y-4 pt-4">
              <Field label={d.shell.fieldEmail}>
                <Input name="email" type="email" autoComplete="off" />
              </Field>
              <Field label={d.shell.fieldPhone}>
                <Input name="phone" type="tel" autoComplete="off" />
              </Field>
                </div>
              </details>
            </>
          )}
          {kind === "lease" && (
            <>
              <ol className="create-progress"><li aria-current={leaseStep === 0 ? "step" : undefined}>1 · {d.experience.leaseDetails}</li><li aria-current={leaseStep === 1 ? "step" : undefined}>2 · {d.experience.leaseMoney}</li></ol>
              <fieldset hidden={leaseStep !== 0} className="space-y-4">
              {/* Only what can take a lease is offered, and nothing is chosen for the owner:
                  a lot that can be let and has no lease in force, a contact recorded as a tenant. */}
              <Field label={d.shell.fieldUnit} hint={vacantUnitOptions.length === 0 ? d.shell.noVacantUnit : undefined}>
                <Select name="unitId" required defaultValue="">
                  <option value="">{d.shell.pickUnit}</option>
                  {vacantUnitOptions.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={d.shell.fieldTenant} hint={tenantOptions.length === 0 ? d.shell.noTenant : undefined}>
                <Select name="tenantContactId" required defaultValue="">
                  <option value="">{d.shell.pickTenant}</option>
                  {tenantOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={d.shell.fieldType}>
                  <Select name="type" defaultValue="residential">
                    <option value="residential">{d.status.leaseType.residential}</option>
                    <option value="commercial">{d.status.leaseType.commercial}</option>
                  </Select>
                </Field>
                <Field label={d.shell.fieldStartDate}>
                  <DateField value={startDate} onChange={setStartDate} placeholder={d.loyers.datePlaceholder} />
                </Field>
              </div>
              </fieldset>
              <fieldset hidden={leaseStep !== 1} disabled={leaseStep === 0} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label={d.shell.fieldRent}>
                  <Input name="rent" required inputMode="decimal" placeholder="1 850,00" />
                </Field>
                <Field label={d.shell.fieldCharges}>
                  <Input name="charges" inputMode="decimal" placeholder="220,00" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={d.shell.fieldDepositMonths}>
                  <Input name="depositMonths" type="number" inputMode="numeric" min={0} max={12} defaultValue={2} />
                </Field>
                <Field label={d.shell.fieldDepositForm}>
                  <Select name="depositForm" defaultValue="cash">
                    {(["cash", "bank_guarantee", "third_party_caution", "insurance", "state_guarantee"] as const).map(
                      (fm) => (
                        <option key={fm} value={fm}>
                          {d.status.depositForm[fm]}
                        </option>
                      ),
                    )}
                  </Select>
                </Field>
              </div>
              </fieldset>
            </>
          )}
          {kind === "payment" && (
            <>
              <Field label={d.shell.fieldUnit}>
                <Select name="leaseId" required defaultValue={leaseOptions[0]?.id}>
                  {leaseOptions.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={d.shell.fieldAmount}>
                  <Input name="amount" required inputMode="decimal" placeholder="1 850,00" />
                </Field>
                <Field label={d.shell.fieldReceivedOn}>
                  <DateField value={receivedOn} onChange={setReceivedOn} placeholder={d.loyers.datePlaceholder} />
                </Field>
              </div>
              {/* One key per opened form: the same payment sent twice (a double click, a retry) is written once. */}
              <input type="hidden" name="requestKey" value={paymentKey} readOnly />
            </>
          )}
          {kind === "ticket" && (
            <>
              <Field label={d.shell.fieldUnit}>
                <Select name="unitId" required defaultValue={unitOptions[0]?.id}>
                  {unitOptions.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={d.shell.fieldTitle}>
                <Input name="title" required maxLength={200} />
              </Field>
            </>
          )}
          <InlineError>{fieldError}</InlineError>
          <ApiProblemNote problem={problem} />
          {submitted && !real && <p role="status" className="rounded-xl bg-brand-50 px-4 py-3 text-sm font-medium text-brand-800">{d.common.demoCreateNotice}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            {kind === "lease" && leaseStep === 1 && <Button type="button" variant="ghost" onClick={() => setLeaseStep(0)}>{d.common.back}</Button>}
            <Button type="button" variant="ghost" onClick={onClose}>
              {d.common.cancel}
            </Button>
            <Button type="submit" disabled={saving}>
              {kind === "lease" && leaseStep === 0 ? d.common.next : d.shell.submitCreate}
            </Button>
          </div>
        </form>
      )}

    </Modal>
  );
}

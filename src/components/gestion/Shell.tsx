"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import { useDismiss } from "@/lib/useDismiss";
import { Button, Field, InlineError, Input, Modal, Select } from "@/components/pro/ui";
import { Icon, type IconName } from "@/components/pro/icons";
import NavigationProgress from "@/components/NavigationProgress";
import GestionLogo from "./GestionLogo";
import SidebarNav from "./SidebarNav";
import MobileDrawer from "./MobileDrawer";
import ScrollHeader from "./ScrollHeader";
import GettingStarted, { type Progress } from "./GettingStarted";
import { BillingBanner, Paywall, TrialChip, TrialPrompt, type ShellBilling } from "./BillingShell";
import type { Dict } from "@/lib/i18n/fr";
import { MORADA_URL, PRO_URL, WELCOME_URL } from "@/lib/constants";
import { LOCALES, LOCALE_LABELS, fmt, type Locale } from "@/lib/i18n/config";
import type { SearchHit } from "@/lib/demo/search";
import type { DatasetId } from "@/lib/demo";

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
  userName: string;
  userEmail: string;
  badges: { review: number; unread: number };
  searchIndex: SearchHit[];
  unitOptions: Array<{ id: string; label: string }>;
  leaseOptions: Array<{ id: string; label: string }>;
  contactOptions: Array<{ id: string; label: string }>;
  /** What the account's own rows attest for the getting-started card. */
  progress: Progress;
  /** The workspace's subscription, when subscriptions are on and the data is its own. */
  billing: ShellBilling | null;
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

function destinations(d: Dict, badges: { review: number; unread: number }, workspaceKind: string): NavItem[] {
  // AML/KYC is a cabinet obligation: on an owner-kind workspace the entry
  // simply does not exist — same product, two densities, zero configuration.
  const cabinet = workspaceKind !== "owner";
  return [
    { href: "/app", label: d.nav.home, icon: "dashboard" },
    {
      // Patrimoine is deliberately two lines. A bail, a compteur, une
      // garantie, un EDL, une assurance and l'indexation are not modules an
      // owner goes looking for: they belong to a property, and they open
      // from it. The routes stay, the rail stops listing them.
      href: "/app/biens",
      label: d.nav.patrimoine,
      icon: "properties",
      children: [
        { href: "/app/biens", label: d.hubs.portfolio },
        { href: "/app/interventions", label: d.hubs.interventions },
      ],
      also: [
        "/app/baux",
        "/app/compteurs",
        "/app/indexation",
        "/app/garanties",
        "/app/edl",
        "/app/assurances",
      ],
    },
    {
      href: "/app/contacts",
      label: d.nav.relations,
      icon: "contacts",
      badge: badges.unread || undefined,
      children: [
        { href: "/app/contacts", label: d.hubs.people },
        { href: "/app/messages", label: d.hubs.messages, badge: badges.unread || undefined },
      ],
    },
    {
      href: "/app/loyers",
      label: d.nav.finances,
      also: ["/app/financement"],
      icon: "euro",
      badge: badges.review || undefined,
      children: [
        { href: "/app/loyers", label: d.hubs.collections },
        { href: "/app/finance", label: d.hubs.expenses },
        { href: "/app/banque", label: d.hubs.banking, badge: badges.review || undefined },
        { href: "/app/charges", label: d.hubs.statements },
        { href: "/app/fiscalite", label: d.hubs.reports },
        { href: "/app/emprunts", label: d.nav.mortgages },
        { href: "/app/acquisitions", label: d.nav.acquisitions },
      ],
    },
    {
      href: "/app/documents",
      label: d.nav.documents,
      icon: "documents",
      children: [
        { href: "/app/documents", label: d.hubs.library },
        { href: "/app/contrats", label: d.hubs.contracts },
      ],
    },
    {
      href: "/app/conformite",
      label: d.nav.compliance,
      icon: "shield-check",
      children: [
        { href: "/app/conformite", label: d.hubs.compliance },
        ...(cabinet ? [{ href: "/app/aml", label: d.hubs.aml }] : []),
      ],
    },
    {
      href: "/app/reglages",
      label: d.nav.settings,
      icon: "settings",
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
  const reduced = useReducedMotion();

  const NAV = useMemo(
    () => destinations(d, shell.badges, shell.workspaceKind),
    [d, shell.badges, shell.workspaceKind],
  );
  const NAVIGABLE = useMemo(() => navigable(NAV, d), [NAV, d]);

  // The everyday destinations are visible from the first render. Explicit
  // choices last for this visit; arriving in another group reveals its location.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    "/app/biens": true,
    "/app/contacts": true,
    "/app/loyers": true,
  });
  useEffect(() => {
    const active = destinations(d, shell.badges, shell.workspaceKind).find(
      (i) => i.children && matchesOf(i).some((m) => pathname.startsWith(m)),
    );
    if (active) setExpanded((prev) => (prev[active.href] ? prev : { ...prev, [active.href]: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  const real = shell.datasetId === "real";
  // The document vault has no real upload backend yet: on a real account the
  // quick-add offers only what actually persists.
  const QUICK_ADD = useMemo(() => quickAdd(d).filter((i) => !real || i.kind !== "document"), [d, real]);

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
    // the dataset switch and ecosystem links stay below. On short landscape
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
      <div className="crm-workspace">
        <span className="crm-workspace-icon"><Icon name="properties" size={19} /></span>
        <span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink">{shell.orgShortName}</span>
          <span className="block text-xs text-ink-soft">{d.shell.roleOwner}</span>
        </span>
      </div>
      <SidebarNav items={NAV} pathname={pathname} expanded={expanded} onNavigate={() => setMobileOpen(false)}
        onToggle={(href) => setExpanded((prev) => ({ ...prev, [href]: !prev[href] }))} />
    </nav>
    <div className="crm-sidebar-footer shrink-0 border-t border-sand-100 px-3 pb-[max(0.75rem,var(--safe-bottom))] pt-2">
      {/* The role switch lives here below `xl`, and in the toolbar above: the
          same two segments, one thumb's size each, so the tenant space is
          as reachable from a phone as from a laptop. */}
      {shell.tenant && (
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
      )}
      <DatasetSwitch d={d} datasetId={shell.datasetId} />
      <div className="pt-2.5 text-[11px] text-ink-soft">
        <p className="px-3">{d.nav.ecosystem}</p>
        <div className="flex gap-3 px-3 pt-0.5">
          <a href={MORADA_URL} className="rounded hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 max-sm:inline-flex max-sm:min-h-10 max-sm:items-center max-sm:px-1">Morada</a>
          <a href={PRO_URL} className="rounded hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 max-sm:inline-flex max-sm:min-h-10 max-sm:items-center max-sm:px-1">Pro</a>
        </div>
      </div>
    </div>
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
      <div className="crm-shell min-h-dvh">
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

            <p className="crm-location hidden truncate text-sm font-medium text-ink md:block">{NAV.find((item) => item.href === "/app" ? pathname === "/app" : matchesOf(item).some((path) => pathname.startsWith(path)))?.label ?? d.nav.home}</p>
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
                className="inline-flex min-h-8 items-center rounded px-1 underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                {d.shell.sampleBack}
              </button>
            </div>
          )}

          {shell.billing && <BillingBanner billing={shell.billing} d={d} locale={locale} />}

          {/* On a phone the page ends clear of the home indicator, and of the
              floating getting-started card when the account has one. A
              conversation open over the phone's screen gets the screen whole:
              no gutter, no width limit (the card keeps the safe areas itself). */}
          <main id="main" tabIndex={-1} className={"crm-main mx-auto w-full max-w-6xl flex-1 px-safe-4 py-6 pb-[max(1.5rem,var(--safe-bottom))] max-lg:[html[data-phone-chat]_&]:max-w-none max-lg:[html[data-phone-chat]_&]:p-0 sm:px-safe-6" + (shell.sampleCabinet ? "" : " max-lg:pb-24")}>
            {pathname === "/app" && shell.billing && <TrialPrompt billing={shell.billing} d={d} locale={locale} />}
            {children}
          </main>
        </div>

        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          d={d}
          nav={NAVIGABLE}
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
          real={real}
          unitOptions={shell.unitOptions}
          leaseOptions={shell.leaseOptions}
          contactOptions={shell.contactOptions}
        />

        {shell.billing && <Paywall billing={shell.billing} d={d} locale={locale} />}

        {/* A "0% done" checklist on top of a full sample cabinet contradicts
            itself. It belongs to the real account only. */}
        {!shell.sampleCabinet && <GettingStarted d={d} progress={shell.progress} />}
      </div>
    </MotionConfig>
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
            <Icon name={i.kind === "property" ? "properties" : i.kind === "lease" ? "contract" : i.kind === "contact" ? "contacts" : i.kind === "payment" ? "euro" : i.kind === "ticket" ? "tasks" : "documents"} size={21}/>{i.label}
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
        <a href={MORADA_URL} className="block rounded-lg px-3 py-2 text-sm text-ink hover:bg-sand-50">
          {d.shell.moradaAccount}
        </a>
        {/* Back to the gateway: one account, three spaces. */}
        <a href={WELCOME_URL} className="block rounded-lg px-3 py-2 text-sm text-ink hover:bg-sand-50">
          {d.shell.switchSpace}
        </a>
        <div className="mt-1 border-t border-sand-100 pt-1">
          {!signedIn && signedOutNote ? (
            <p role="status" className="rounded-lg px-3 py-2 text-xs font-semibold text-emerald-800">
              {d.common.demoNotice}
            </p>
          ) : (
            <button
              onClick={signedIn ? signOut : () => setSignedOutNote(true)}
              disabled={leaving}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {d.shell.signOut}
            </button>
          )}
        </div>
      </Dropdown>
    </div>
  );
}

/* ----------------------------- dataset switch ------------------------------- */

function DatasetSwitch({ d, datasetId }: { d: Dict; datasetId: DatasetId }) {
  const router = useRouter();
  const pick = (id: DatasetId) => {
    if (id === datasetId) return;
    document.cookie = `morada_dataset=${id}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
  const describe: Record<DatasetId, string> = {
    real: d.shell.datasetRealDesc,
    fr: d.shell.datasetFr,
    lu: d.shell.datasetLu,
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
        className="mt-2 grid grid-cols-3 gap-1 rounded-xl border border-sand-200 bg-sand-50 p-1"
      >
        {(["real", "fr", "lu"] as const).map((id) => (
          <button
            key={id}
            role="radio"
            aria-checked={id === datasetId}
            onClick={() => pick(id)}
            title={describe[id]}
            className={
              "rounded-lg px-2 py-1.5 text-xs font-semibold transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 max-sm:min-h-10 " +
              (id === datasetId ? "bg-white text-brand-800 shadow-sm" : "text-ink-soft hover:text-ink")
            }
          >
            {id === "real" ? d.shell.datasetReal : id.toUpperCase()}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-ink-soft">{describe[datasetId]}</p>
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

function CreateDialog({
  kind,
  onClose,
  d,
  real,
  unitOptions,
  leaseOptions,
  contactOptions,
}: {
  kind: CreateKind | null;
  onClose: () => void;
  d: Dict;
  real: boolean;
  unitOptions: Array<{ id: string; label: string }>;
  leaseOptions: Array<{ id: string; label: string }>;
  contactOptions: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [leaseStep, setLeaseStep] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLeaseStep(0);
    setSubmitted(false);
    setSaving(false);
    setError(null);
  }, [kind]);

  useEffect(() => {
    if (kind !== "lease") return;
    formRef.current?.querySelector<HTMLElement>('fieldset:not([hidden]) input, fieldset:not([hidden]) select')?.focus();
  }, [kind, leaseStep]);

  // On a real account the form persists through the API, under the caller's
  // own session; the sample cabinets keep their explicitly-fake dialog.
  const submitReal = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!kind) return;
    const f = new FormData(e.currentTarget);
    const v = (name: string) => String(f.get(name) ?? "");
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
              startDate: v("startDate"),
              rent: v("rent"),
              charges: v("charges"),
              depositMonths: Number(v("depositMonths") || 2),
              depositForm: v("depositForm"),
            }
          : kind === "payment"
            ? { leaseId: v("leaseId"), amount: v("amount"), receivedOn: v("receivedOn") }
            : { unitId: v("unitId"), title: v("title") };
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(endpoint[kind]!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
        <form ref={formRef} className="space-y-4 crm-create-form" onSubmit={(event) => { if (kind === "lease" && leaseStep === 0) { event.preventDefault(); setLeaseStep(1); } else if (real) void submitReal(event); else { event.preventDefault(); setSubmitted(true); } }}>
          {kind === "contact" && (
            <>
              <div className="create-intro"><span className="crm-symbol"><Icon name="contacts" size={24} /></span><p>{d.experience.contactHint}</p></div>
              <Field label={`${d.shell.fieldName} *`}>
                <Input aria-label={d.shell.fieldName} name="name" autoComplete="name" required maxLength={120} />
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
                <Input name="email" type="email" autoComplete="email" />
              </Field>
              <Field label={d.shell.fieldPhone}>
                <Input name="phone" type="tel" autoComplete="tel" />
              </Field>
                </div>
              </details>
            </>
          )}
          {kind === "lease" && (
            <>
              <ol className="create-progress"><li aria-current={leaseStep === 0 ? "step" : undefined}>1 · {d.experience.leaseDetails}</li><li aria-current={leaseStep === 1 ? "step" : undefined}>2 · {d.experience.leaseMoney}</li></ol>
              <fieldset hidden={leaseStep !== 0} className="space-y-4">
              <Field label={d.shell.fieldUnit}>
                <Select name="unitId" required defaultValue={unitOptions[0]?.id}>
                  {unitOptions.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={d.shell.fieldTenant}>
                <Select name="tenantContactId" required defaultValue={contactOptions[0]?.id}>
                  {contactOptions.map((c) => (
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
                  <Input name="startDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
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
                  <Input name="depositMonths" type="number" min={0} max={12} defaultValue={2} />
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
                  <Input name="receivedOn" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
                </Field>
              </div>
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
          {(kind === "property" || kind === "document") && null}

          <InlineError>{error}</InlineError>
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

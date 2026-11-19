import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import GestionLogo from "@/components/gestion/GestionLogo";
import ScrollHeader from "@/components/gestion/ScrollHeader";
import TenantAccountMenu from "@/components/gestion/TenantAccountMenu";
import TenantBottomNav from "@/components/gestion/TenantBottomNav";
import TenantTabs from "@/components/gestion/TenantTabs";
import { TenantBecomeOwner, TenantSampleBanner } from "@/components/gestion/TenantChrome";
import { getDemo } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { SEEN_COOKIE, parseSeen } from "@/lib/portal/seen";
import { getTenantView } from "@/lib/portal/space";
import { todoFor, unreadCount } from "@/lib/portal/view";
import { getSession } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Morada Gestion · Espace locataire",
  robots: { index: false, follow: false },
};

/**
 * The tenant's space: five destinations, one header, no configuration. The
 * space is read under the visitor's own session; without one there is
 * nothing to show and the visitor is sent to sign in, coming back here. On
 * a sample cabinet the sample tenant stands in, announced by the same amber
 * line as the management space. Above `lg` the destinations are tabs under
 * the logo; on a phone they are a bar fixed at the foot of the screen
 * (TenantBottomNav): home, payments, requests and messages, "Plus" holding
 * the lease, the documents, the profile and the settings, and the page has
 * the whole width to itself. The tenant's name and avatar open their
 * account (profile, settings, signing out) on every screen. Messages carry
 * the count of what the other side wrote since the tenant last looked. A
 * conversation open on a phone has the whole screen: every piece of chrome
 * here reads `html[data-phone-chat]` and steps aside.
 */
export default async function TenantLayout({ children }: { children: React.ReactNode }) {
  const { d } = await getI18n();
  const view = await getTenantView();
  if (view.kind === "signed_out") redirect("/connexion?next=/locataire");
  const session = await getSession();
  const { space, sample, canManage } = view;
  const sampleCabinet = sample ? (await getDemo()).ORG.shortName : null;

  // What the other side wrote since this browser last showed the conversation (or since the tenant's own last word).
  const unread = unreadCount(space.conversations, parseSeen((await cookies()).get(SEEN_COOKIE)?.value));
  const unreadBadge = unread > 0 ? { count: unread, label: fmt(d.tenant.unreadAria, { n: unread }) } : undefined;
  // A paper the tenant still owes (the insurance certificate) is said where the documents are.
  const toSend = space.current ? todoFor(space.current, space.payments, space.today).filter((a) => a.kind === "insurance_missing").length : 0;

  const tabs = [
    { href: "/locataire", label: d.tenant.navHome },
    { href: "/locataire/bail", label: d.tenant.navLease },
    { href: "/locataire/paiements", label: d.tenant.navPayments },
    { href: "/locataire/messages", label: d.tenant.navMessages, badge: unreadBadge },
    { href: "/locataire/demandes", label: d.tenant.navRequests },
  ];
  const managers = space.managers.map((m) => m.name).filter(Boolean).join(" · ");

  return (
    <div className="tenant-space min-h-dvh bg-sand-50">
      {/* A conversation filling a phone's screen (Messages, `html[data-phone-chat]`)
          is the whole screen: the bar, the sample line, the foot and the bottom bar
          step aside, and the conversation's own header takes the top. */}
      <ScrollHeader
        className="chrome-material sticky top-0 z-30 border-b border-transparent bg-white transition-[border-color,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] supports-[backdrop-filter]:bg-white/85 supports-[backdrop-filter]:backdrop-blur-xl supports-[backdrop-filter]:backdrop-saturate-150 max-lg:[html[data-phone-chat]_&]:hidden"
        elevated="border-sand-100 shadow-[0_1px_10px_rgba(31,41,36,0.05)]"
      >
        <div className="mx-auto flex h-(--bar-h) w-full max-w-6xl items-center gap-3 px-safe-4 pt-(--safe-top) sm:px-safe-6">
          <Link href="/locataire" aria-label="Morada">
            <GestionLogo />
          </Link>
          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-700 max-sm:hidden">
            {d.tenant.space}
          </span>
          {canManage && (
            <nav aria-label={d.shell.roleAria} className="ml-1 flex gap-1 rounded-xl border border-sand-200 bg-sand-50 p-1 max-sm:hidden">
              <a href="/app" className="rounded-lg px-3 py-1 text-xs font-semibold text-ink-soft hover:text-ink">
                {d.shell.roleOwner}
              </a>
              <span aria-current="true" className="rounded-lg bg-white px-3 py-1 text-xs font-semibold text-brand-800 shadow-sm">
                {d.shell.roleTenant}
              </span>
            </nav>
          )}
          <div className="flex-1" />
          {space.me.name && (
            <TenantAccountMenu
              name={space.me.name}
              email={space.me.email}
              signedIn={Boolean(session)}
              labels={{ menu: d.tenant.accountMenu, profile: d.tenant.navProfile, settings: d.tenant.navSettings, signOut: d.tenant.signOutShort, sampleNotice: d.common.demoNotice }}
            />
          )}
        </div>
        <div className="mx-auto w-full max-w-6xl px-safe-4 max-lg:hidden sm:px-safe-6">
          <TenantTabs tabs={tabs} label={d.tenant.space} />
        </div>
      </ScrollHeader>

      {sampleCabinet && (
        <div className="max-lg:[html[data-phone-chat]_&]:hidden">
          <TenantSampleBanner text={fmt(d.shell.sampleBanner, { cabinet: sampleCabinet })} back={d.shell.sampleBack} />
        </div>
      )}

      {/* A conversation open over the phone's screen gets the screen whole: no gutter, no width limit. */}
      <main className="tenant-main mx-auto w-full max-w-6xl px-safe-4 py-6 max-lg:[html[data-phone-chat]_&]:max-w-none max-lg:[html[data-phone-chat]_&]:p-0 sm:px-safe-6">{children}</main>

      {/* The foot of every page stays clear of the bottom bar (--nav-b, zero above lg). */}
      <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-safe-4 pb-[calc(2rem+var(--nav-b))] max-lg:[html[data-phone-chat]_&]:hidden sm:px-safe-6">
        <p className="text-xs text-ink-soft">{managers ? `${managers} · Morada Gestion` : "Morada Gestion"}</p>
        {session && !sample && !canManage && <TenantBecomeOwner label={d.tenant.becomeOwner} failed={d.auth.provisionFailedTitle} />}
      </footer>

      <TenantBottomNav
        label={d.tenant.space}
        closeLabel={d.common.close}
        signOut={session ? d.tenant.signOut : null}
        items={[
          { href: "/locataire", label: d.tenant.tabHome, icon: "home" },
          { href: "/locataire/paiements", label: d.tenant.tabPayments, icon: "euro" },
          { href: "/locataire/demandes", label: d.tenant.navRequests, icon: "inbox" },
          { href: "/locataire/messages", label: d.tenant.tabMessages, icon: "messages", badge: unreadBadge },
        ]}
        more={{
          label: d.tenant.tabMore,
          entries: [
            { href: "/locataire/bail", label: d.tenant.navLease, icon: "contract", desc: d.tenant.moreLeaseDesc },
            { href: "/locataire/documents", label: d.tenant.navDocuments, icon: "documents", desc: d.tenant.moreDocsDesc, note: toSend > 0 ? fmt(d.tenant.moreToSend, { n: toSend }) : undefined },
            { href: "/locataire/profil", label: d.tenant.accountMenu, icon: "user", desc: d.tenant.moreAccountDesc, covers: ["/locataire/parametres"] },
            { href: "/locataire/aide", label: d.tenant.navHelp, icon: "phone", desc: d.tenant.moreHelpDesc },
            ...(canManage ? [{ href: "/app", label: d.tenant.moreOwner, icon: "dashboard" as const }] : []),
          ],
        }}
      />
    </div>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Avatar } from "@/components/pro/ui";
import GestionLogo from "@/components/gestion/GestionLogo";
import ScrollHeader from "@/components/gestion/ScrollHeader";
import TenantBottomNav from "@/components/gestion/TenantBottomNav";
import TenantTabs from "@/components/gestion/TenantTabs";
import { TenantBecomeOwner, TenantSampleBanner, TenantSignOut } from "@/components/gestion/TenantChrome";
import { WELCOME_URL } from "@/lib/constants";
import { getDemo } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { getTenantView } from "@/lib/portal/space";
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
 * (TenantBottomNav), "Plus" holding the rest, and the page has the whole
 * width to itself. A conversation open on a phone has the whole screen:
 * every piece of chrome here reads `html[data-phone-chat]` and steps aside.
 */
export default async function TenantLayout({ children }: { children: React.ReactNode }) {
  const { d } = await getI18n();
  const view = await getTenantView();
  if (view.kind === "signed_out") redirect("/connexion?next=/locataire");
  const session = await getSession();
  const { space, sample, canManage } = view;
  const sampleCabinet = sample ? (await getDemo()).ORG.shortName : null;

  const tabs = [
    { href: "/locataire", label: d.tenant.navHome },
    { href: "/locataire/bail", label: d.tenant.navLease },
    { href: "/locataire/paiements", label: d.tenant.navPayments },
    { href: "/locataire/messages", label: d.tenant.navMessages },
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
        <div className="mx-auto flex h-(--bar-h) w-full max-w-3xl items-center gap-3 px-safe-4 pt-(--safe-top) sm:px-safe-6">
          <a href={WELCOME_URL} aria-label="Morada">
            <GestionLogo />
          </a>
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
            <>
              <span className="hidden text-sm font-semibold text-ink sm:block">{space.me.name}</span>
              <Avatar name={space.me.name} size={32} />
            </>
          )}
          {/* On a phone, signing out sits behind "Plus" in the bottom bar. */}
          {session && (
            <span className="max-lg:hidden">
              <TenantSignOut label={d.tenant.signOut} />
            </span>
          )}
        </div>
        <div className="mx-auto w-full max-w-3xl px-safe-4 max-lg:hidden sm:px-safe-6">
          <TenantTabs tabs={tabs} label={d.tenant.space} />
        </div>
      </ScrollHeader>

      {sampleCabinet && (
        <div className="max-lg:[html[data-phone-chat]_&]:hidden">
          <TenantSampleBanner text={fmt(d.shell.sampleBanner, { cabinet: sampleCabinet })} back={d.shell.sampleBack} />
        </div>
      )}

      {/* A conversation open over the phone's screen gets the screen whole: no gutter, no width limit. */}
      <main className="mx-auto w-full max-w-3xl px-safe-4 py-6 max-lg:[html[data-phone-chat]_&]:max-w-none max-lg:[html[data-phone-chat]_&]:p-0 sm:px-safe-6">{children}</main>

      {/* The foot of every page stays clear of the bottom bar (--nav-b, zero above lg). */}
      <footer className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2 px-safe-4 pb-[calc(2rem+var(--nav-b))] max-lg:[html[data-phone-chat]_&]:hidden sm:px-safe-6">
        <p className="text-[11px] text-ink-soft">{managers ? `${managers} · Morada Gestion` : "Morada Gestion"}</p>
        {session && !sample && !canManage && <TenantBecomeOwner label={d.tenant.becomeOwner} failed={d.auth.provisionFailedTitle} />}
      </footer>

      <TenantBottomNav
        label={d.tenant.space}
        closeLabel={d.common.close}
        signOut={session ? d.tenant.signOut : null}
        items={[
          { href: "/locataire", label: d.tenant.tabHome, icon: "home" },
          { href: "/locataire/bail", label: d.tenant.tabLease, icon: "contract" },
          { href: "/locataire/paiements", label: d.tenant.tabPayments, icon: "euro" },
          { href: "/locataire/messages", label: d.tenant.tabMessages, icon: "messages" },
        ]}
        more={{
          label: d.tenant.tabMore,
          entries: [
            { href: "/locataire/demandes", label: d.tenant.navRequests, icon: "inbox" },
            ...(canManage ? [{ href: "/app", label: d.tenant.moreOwner, icon: "dashboard" as const }] : []),
          ],
        }}
      />
    </div>
  );
}

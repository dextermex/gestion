import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Avatar } from "@/components/pro/ui";
import GestionLogo from "@/components/gestion/GestionLogo";
import ScrollHeader from "@/components/gestion/ScrollHeader";
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
 * The tenant's space: four destinations, one header, no configuration. The
 * space is read under the visitor's own session; without one there is
 * nothing to show and the visitor is sent to sign in, coming back here. On
 * a sample cabinet the sample tenant stands in, announced by the same amber
 * line as the management space.
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
    { href: "/locataire/demandes", label: d.tenant.navRequests },
  ];
  const managers = space.managers.map((m) => m.name).filter(Boolean).join(" · ");

  return (
    <div className="min-h-dvh bg-sand-50">
      <ScrollHeader
        className="chrome-material sticky top-0 z-30 border-b border-transparent bg-white transition-[border-color,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] supports-[backdrop-filter]:bg-white/85 supports-[backdrop-filter]:backdrop-blur-xl supports-[backdrop-filter]:backdrop-saturate-150"
        elevated="border-sand-100 shadow-[0_1px_10px_rgba(31,41,36,0.05)]"
      >
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-4 sm:px-6">
          <a href={WELCOME_URL} aria-label="Morada">
            <GestionLogo />
          </a>
          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-700 max-sm:hidden">
            {d.tenant.space}
          </span>
          {canManage && (
            <nav aria-label={d.shell.roleAria} className="ml-1 flex gap-1 rounded-xl border border-sand-200 bg-sand-50 p-1">
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
          {session && <TenantSignOut label={d.tenant.signOut} />}
        </div>
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
          <TenantTabs tabs={tabs} label={d.tenant.space} />
        </div>
      </ScrollHeader>

      {sampleCabinet && <TenantSampleBanner text={fmt(d.shell.sampleBanner, { cabinet: sampleCabinet })} back={d.shell.sampleBack} />}

      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">{children}</main>

      <footer className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2 px-4 pb-8 sm:px-6">
        <p className="text-[11px] text-ink-soft">{managers ? `${managers} · Morada Gestion` : "Morada Gestion"}</p>
        {session && !sample && !canManage && <TenantBecomeOwner label={d.tenant.becomeOwner} failed={d.auth.provisionFailedTitle} />}
      </footer>
    </div>
  );
}

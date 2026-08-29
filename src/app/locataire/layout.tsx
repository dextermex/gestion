import type { Metadata } from "next";
import { Avatar } from "@/components/pro/ui";
import GestionLogo from "@/components/gestion/GestionLogo";
import ScrollHeader from "@/components/gestion/ScrollHeader";
import { WELCOME_URL } from "@/lib/constants";
import TenantTabs from "@/components/gestion/TenantTabs";
import { getDemo } from "@/lib/demo";
import { tenantPersona } from "@/lib/demo/tenant";
import { getI18n } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Morada Gestion · Espace locataire",
  robots: { index: false, follow: false },
};

export default async function TenantLayout({ children }: { children: React.ReactNode }) {
  const { d } = await getI18n();
  const demo = await getDemo();
  const tenant = tenantPersona(demo)?.tenant ?? null;

  const tabs = [
    { href: "/locataire", label: d.tenant.navHome },
    { href: "/locataire/bail", label: d.tenant.navLease },
    { href: "/locataire/paiements", label: d.tenant.navPayments },
    { href: "/locataire/demandes", label: d.tenant.navRequests },
  ];

  return (
    <div className="min-h-dvh bg-sand-50">
      <ScrollHeader
        className="sticky top-0 z-30 border-b border-transparent bg-white/80 backdrop-blur-xl backdrop-saturate-150 transition-[border-color,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
        elevated="border-sand-100 shadow-[0_1px_10px_rgba(31,41,36,0.05)]"
      >
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-4 sm:px-6">
          <a href={WELCOME_URL} aria-label="Morada">
            <GestionLogo />
          </a>
          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-700 max-sm:hidden">
            {d.tenant.space}
          </span>
          <nav
            aria-label={d.shell.roleAria}
            className="ml-1 flex gap-1 rounded-xl border border-sand-200 bg-sand-50 p-1"
          >
            <a href="/app" className="rounded-lg px-3 py-1 text-xs font-semibold text-ink-soft hover:text-ink">
              {d.shell.roleOwner}
            </a>
            <span aria-current="true" className="rounded-lg bg-white px-3 py-1 text-xs font-semibold text-brand-800 shadow-sm">
              {d.shell.roleTenant}
            </span>
          </nav>
          <div className="flex-1" />
          {tenant && (
            <>
              <span className="hidden text-sm font-semibold text-ink sm:block">{tenant.name}</span>
              <Avatar name={tenant.name} size={32} />
            </>
          )}
        </div>
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
          <TenantTabs tabs={tabs} />
        </div>
      </ScrollHeader>

      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">{children}</main>

      <footer className="mx-auto w-full max-w-3xl px-4 pb-8 sm:px-6">
        <p className="text-[11px] text-ink-soft">{demo.ORG.shortName} · Morada Gestion</p>
      </footer>
    </div>
  );
}

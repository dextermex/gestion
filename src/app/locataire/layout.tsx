import type { Metadata } from "next";
import { Avatar } from "@/components/pro/ui";
import GestionLogo from "@/components/gestion/GestionLogo";
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
  const { tenant } = tenantPersona(demo);

  const tabs = [
    { href: "/locataire", label: d.tenant.navHome },
    { href: "/locataire/bail", label: d.tenant.navLease },
    { href: "/locataire/paiements", label: d.tenant.navPayments },
    { href: "/locataire/demandes", label: d.tenant.navRequests },
  ];

  return (
    <div className="min-h-dvh bg-sand-50">
      <header className="border-b border-sand-100 bg-white">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-4 sm:px-6">
          <GestionLogo />
          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-700">
            {d.tenant.space}
          </span>
          <div className="flex-1" />
          <span className="hidden text-sm font-semibold text-ink sm:block">{tenant.name}</span>
          <Avatar name={tenant.name} size={32} />
        </div>
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
          <TenantTabs tabs={tabs} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">{children}</main>

      <footer className="mx-auto w-full max-w-3xl px-4 pb-8 sm:px-6">
        <p className="text-[11px] text-ink-soft">{demo.ORG.shortName} · Morada Gestion</p>
      </footer>
    </div>
  );
}

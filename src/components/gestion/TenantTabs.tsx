"use client";

import Link from "next/link";
import { Icon, type IconName } from "@/components/pro/icons";
const TAB_ICONS: Record<string, IconName> = { "/locataire": "home", "/locataire/bail": "contract", "/locataire/paiements": "euro", "/locataire/messages": "messages", "/locataire/demandes": "inbox" };
import { usePathname } from "next/navigation";

export default function TenantTabs({
  tabs,
  label,
}: {
  tabs: Array<{ href: string; label: string }>;
  label: string;
}) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/locataire" ? pathname === "/locataire" : pathname.startsWith(href);
  return (
    <nav className="tenant-tabs scroll-x -mb-px flex gap-1" aria-label={label}>
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={isActive(t.href) ? "page" : undefined}
          className={
            "flex shrink-0 items-center border-b-2 px-3 py-2.5 text-sm font-semibold transition max-sm:min-h-11 max-sm:px-2.5 " +
            (isActive(t.href)
              ? "border-brand-600 text-brand-800"
              : "border-transparent text-ink-soft hover:border-sand-200 hover:text-ink")
          }
        >
          <Icon name={TAB_ICONS[t.href] ?? "home"} size={20} />{t.label}
        </Link>
      ))}
    </nav>
  );
}

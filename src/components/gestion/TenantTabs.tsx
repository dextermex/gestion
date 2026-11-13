"use client";

import Link from "next/link";
import { Icon, type IconName } from "@/components/pro/icons";
const TAB_ICONS: Record<string, IconName> = { "/locataire": "home", "/locataire/bail": "contract", "/locataire/paiements": "euro", "/locataire/messages": "messages", "/locataire/demandes": "inbox" };
import { usePathname } from "next/navigation";

export default function TenantTabs({
  tabs,
  label,
}: {
  /** `badge`: a count worth showing beside the tab (unread messages), with the words a screen reader says for it. */
  tabs: Array<{ href: string; label: string; badge?: { count: number; label: string } }>;
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
          {t.badge && t.badge.count > 0 && (
            <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-600 px-1.5 text-[11px] font-bold leading-none text-white" aria-label={t.badge.label}>
              {t.badge.count > 9 ? "9+" : t.badge.count}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}

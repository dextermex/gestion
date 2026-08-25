"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function TenantTabs({
  tabs,
}: {
  tabs: Array<{ href: string; label: string }>;
}) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/locataire" ? pathname === "/locataire" : pathname.startsWith(href);
  return (
    <nav className="no-scrollbar -mb-px flex gap-1 overflow-x-auto" aria-label="Espace locataire">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={isActive(t.href) ? "page" : undefined}
          className={
            "flex shrink-0 items-center border-b-2 px-3.5 py-2.5 text-sm font-semibold transition max-sm:min-h-11 " +
            (isActive(t.href)
              ? "border-brand-600 text-brand-800"
              : "border-transparent text-ink-soft hover:border-sand-200 hover:text-ink")
          }
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

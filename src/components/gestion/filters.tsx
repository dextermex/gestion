import Link from "next/link";

/**
 * The immocloud list-page grammar, in Morada tokens: ChipLink, a small
 * filter pill, URL-driven so pages stay server components and views stay
 * shareable links.
 */

export function ChipLink({
  href,
  active,
  count,
  children,
}: {
  href: string;
  active?: boolean;
  /** Optional count, rendered as a small pill — the banking-page grammar,
   *  shared by every list page so filters read the same everywhere. */
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={
        "crm-filter tactile flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 max-sm:min-h-11 " +
        (active
          ? "bg-brand-600 text-white"
          : "border border-sand-200 bg-white text-ink-soft hover:border-brand-200 hover:text-brand-700")
      }
    >
      {children}
      {count !== undefined && (
        <span
          className={
            "rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums " +
            (active ? "bg-white/20 text-white" : "bg-sand-100 text-ink-soft")
          }
        >
          {count}
        </span>
      )}
    </Link>
  );
}

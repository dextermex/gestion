import Link from "next/link";

/**
 * The immocloud list-page grammar, in Morada tokens:
 * - CountCard — big number + label, acting as a filter tab (URL-driven, so
 *   pages stay server components and views stay shareable links).
 * - ChipLink — small filter pill for secondary dimensions.
 * Selection is a border+ring, never a fill: color stays reserved for data.
 */

export function CountCard({
  href,
  value,
  label,
  selected,
  tone = "default",
}: {
  href: string;
  value: string | number;
  label: string;
  selected?: boolean;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const valueColor =
    tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : tone === "bad" ? "text-red-700" : "text-ink";
  return (
    <Link
      href={href}
      aria-current={selected ? "true" : undefined}
      className={
        "block rounded-2xl border bg-white p-4 shadow-sm transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] " +
        (selected
          ? "border-brand-400 ring-1 ring-brand-200"
          : "border-sand-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md motion-reduce:hover:translate-y-0")
      }
    >
      <p className={`font-display text-2xl font-bold tracking-tight tabular-nums ${valueColor}`}>{value}</p>
      <p className="mt-0.5 text-xs font-semibold text-ink-soft">{label}</p>
    </Link>
  );
}

export function ChipLink({
  href,
  active,
  children,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={
        "flex shrink-0 items-center rounded-full px-3.5 py-1.5 text-sm font-medium transition max-sm:min-h-11 " +
        (active
          ? "bg-brand-600 text-white"
          : "border border-sand-200 bg-white text-ink-soft hover:border-brand-200 hover:text-brand-700")
      }
    >
      {children}
    </Link>
  );
}

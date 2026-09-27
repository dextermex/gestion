import Link from "next/link";
import { Icon, type IconName } from "@/components/pro/icons";
import { Badge, Card } from "@/components/pro/ui";
import type { Meta } from "@/lib/types";

/** KPI tile — tone drives the value colour (Morada gestion convention). */
export function Kpi({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "good" | "bad";
}) {
  return (
    <Card className="crm-kpi p-5">
      <p className="text-sm font-medium text-ink-soft">{label}</p>
      <p
        className={
          "mt-1 font-display text-2xl font-bold tracking-tight tabular-nums " +
          (tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : "text-ink")
        }
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-ink-soft">{sub}</p>}
    </Card>
  );
}

export function MetaBadge({ meta }: { meta: Meta }) {
  return <Badge className={meta.color}>{meta.label}</Badge>;
}

/** Panel with the standard card heading. */
export function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={"crm-panel p-5 " + (className ?? "")}>
      <div className="crm-panel-heading mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

const EVENT_ICONS: Record<string, IconName> = {
  payment: "euro", lease: "key", document: "documents", ticket: "tasks", letter: "mail", system: "bell",
};

export function Timeline({ entries }: {
  entries: Array<{ kind: string; label: string; sub?: string; at: string; amount?: string }>;
}) {
  return <ol className="crm-timeline">
    {entries.map((entry, index) => <li key={index}>
      <span className="crm-symbol"><Icon name={EVENT_ICONS[entry.kind] ?? "bell"} size={22} /></span>
      <div className="crm-timeline-body">
        <span className="crm-timeline-date">{entry.at}</span>
        <p className="crm-timeline-title">{entry.label}</p>
        {entry.sub && <p className="crm-timeline-sub">{entry.sub}</p>}
        {entry.amount && <span className="crm-timeline-amount">{entry.amount}</span>}
      </div>
    </li>)}
  </ol>;
}

/** Standard list row with chevron, linking to a record. */
export function LinkRow({
  href,
  title,
  sub,
  right,
}: {
  href: string;
  title: string;
  sub?: string;
  right?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="crm-link-row tactile flex items-center gap-3 rounded-xl py-3 transition hover:bg-sand-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600"
    >
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-semibold text-ink">{title}</p>
        {sub && <p className="line-clamp-1 text-xs text-ink-soft">{sub}</p>}
      </div>
      {right}
      <svg className="h-4 w-4 shrink-0 text-ink-soft" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
      </svg>
    </Link>
  );
}

/**
 * Reference material folded away by default — the screen leads with what needs
 * doing, and the "how the engine works" panels open on demand. Plain
 * <details>, so server components can use it and it works without JS.
 */
export function CollapsiblePanel({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <details className="group/fold">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl p-5 transition hover:bg-sand-50/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 [&::-webkit-details-marker]:hidden">
          <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
          <svg
            className="h-4 w-4 shrink-0 text-ink-soft transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-open/fold:rotate-180 motion-reduce:transition-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <div className="px-5 pb-5">{children}</div>
      </details>
    </Card>
  );
}

/** Inline legal-basis note — every enforced rule names its statute. */
export function LegalNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-soft">
      <svg className="mt-0.5 h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3 4 6v5c0 5 3.4 8.4 8 10 4.6-1.6 8-5 8-10V6l-8-3Z" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

/** The way through a long list: the page it is on, and the two next to it. Hidden while one page holds everything. */
export function Pagination({
  page,
  pages,
  hrefFor,
  labels,
}: {
  page: number;
  pages: number;
  hrefFor: (page: number) => string;
  labels: { prev: string; next: string; pageOf: string };
}) {
  if (pages <= 1) return null;
  const link = "inline-flex min-h-10 items-center rounded-xl border border-sand-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:border-brand-300 hover:text-brand-700";
  return (
    <nav className="mt-4 flex items-center justify-between gap-3" aria-label={labels.pageOf} data-pagination>
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className={link}>
          {labels.prev}
        </Link>
      ) : (
        <span />
      )}
      <span className="text-xs font-semibold text-ink-soft">{labels.pageOf}</span>
      {page < pages ? (
        <Link href={hrefFor(page + 1)} className={link}>
          {labels.next}
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

import Link from "next/link";
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
    <Card className="p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{label}</p>
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
    <Card className={"p-5 " + (className ?? "")}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** Timeline row dot colours by event kind (-500 step, per convention). */
const KIND_DOT: Record<string, string> = {
  payment: "bg-emerald-500",
  lease: "bg-violet-500",
  document: "bg-amber-500",
  ticket: "bg-sky-500",
  letter: "bg-accent-500",
  system: "bg-brand-500",
};

export function Timeline({
  entries,
}: {
  entries: Array<{ kind: string; label: string; sub?: string; at: string }>;
}) {
  return (
    <ul className="space-y-3">
      {entries.map((e, i) => (
        <li key={i} className="flex items-start gap-3">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${KIND_DOT[e.kind] ?? "bg-sand-300"}`} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink">{e.label}</p>
            {e.sub && <p className="text-xs text-ink-soft">{e.sub}</p>}
          </div>
          <p className="shrink-0 text-[11px] text-ink-soft">{e.at}</p>
        </li>
      ))}
    </ul>
  );
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
    <Link href={href} className="flex items-center gap-3 py-3 transition hover:bg-sand-50">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{title}</p>
        {sub && <p className="truncate text-xs text-ink-soft">{sub}</p>}
      </div>
      {right}
      <svg className="h-4 w-4 shrink-0 text-ink-soft" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
      </svg>
    </Link>
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

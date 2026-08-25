import Link from "next/link";
import { Card } from "@/components/pro/ui";

/**
 * Ring-donut KPI card — one ring, one number, one action (the immocloud
 * "personal overview" formula in Morada's design language). Server-rendered
 * SVG; the draw-in is pure CSS with the global reduced-motion escape.
 */

export function Ring({ fraction, label }: { fraction: number; label: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, fraction));
  const target = c * (1 - clamped);
  return (
    <svg viewBox="0 0 64 64" className="h-16 w-16 shrink-0" role="img" aria-label={label}>
      <circle cx="32" cy="32" r={r} fill="none" className="stroke-sand-100" strokeWidth="7" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        className="ring-draw stroke-brand-600"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={target}
        transform="rotate(-90 32 32)"
        style={{ ["--ring-c" as string]: `${c}`, ["--ring-target" as string]: `${target}` }}
      />
      <text
        x="32"
        y="32"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-ink font-display text-[13px] font-bold tabular-nums"
      >
        {Math.round(clamped * 100)}%
      </text>
    </svg>
  );
}

export function RingCard({
  fraction,
  label,
  value,
  sub,
  actionHref,
  actionLabel,
}: {
  fraction: number;
  label: string;
  value: string;
  sub: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center gap-4">
        <Ring fraction={fraction} label={label} />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{label}</p>
          <p className="mt-0.5 truncate font-display text-2xl font-bold tracking-tight tabular-nums text-ink">
            {value}
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-soft">{sub}</p>
        </div>
      </div>
      <Link
        href={actionHref}
        className="group mt-4 flex items-center justify-between border-t border-sand-100 pt-3 text-sm font-semibold text-brand-700 hover:text-brand-800"
      >
        {actionLabel}
        <svg
          className="h-4 w-4 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
        </svg>
      </Link>
    </Card>
  );
}

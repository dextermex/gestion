import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/pro/icons";
import HeroCreate from "@/components/gestion/HeroCreate";

/**
 * The head of a manager screen, as the iPhone app draws it: one question,
 * answered by one figure on the teal ground, what supports it as chips, and
 * the two to four actions that belong to the screen as a round row. It is
 * the one raised element of the page; everything under it is a flat list.
 */
export function Hero({ eyebrow, top, label, figure, children, actions, aside }: {
  /** A quiet line over everything (the greeting). */
  eyebrow?: ReactNode;
  /** Top right: the month switch. */
  top?: ReactNode;
  label: string;
  figure: ReactNode;
  /** Chips under the figure. */
  children?: ReactNode;
  actions?: ReactNode;
  /** Beside the figure from `lg`, under it on a phone (the ring). */
  aside?: ReactNode;
}) {
  return (
    <section className="hero-card relative overflow-hidden rounded-[28px] px-5 pb-7 pt-5 text-white sm:px-9 sm:pb-9 sm:pt-7">
      <div className="flex min-h-10 items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium text-white/70">{eyebrow}</p>
        {top}
      </div>
      <div className="mt-5 grid grid-cols-1 items-center gap-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-12">
        <div className="min-w-0 max-lg:text-center">
          <p className="text-sm font-medium text-white/70">{label}</p>
          <p className="mt-1.5 font-display text-5xl font-bold leading-none tracking-tight tabular-nums sm:text-6xl">{figure}</p>
          {children && <div className="mt-5 flex flex-wrap items-center gap-2 max-lg:justify-center">{children}</div>}
        </div>
        {aside && <div className="flex justify-center">{aside}</div>}
      </div>
      {actions && <div className="mt-7 flex flex-wrap gap-x-6 gap-y-4 max-lg:justify-center max-sm:gap-x-2">{actions}</div>}
    </section>
  );
}

/** A figure with its euro sign set smaller, the way the app sets large amounts. */
export function Money({ value }: { value: string }) {
  const at = value.indexOf("€");
  if (at < 0) return <>{value}</>;
  return (
    <>
      {value.slice(0, at)}
      <span className="text-[0.62em] font-semibold">€</span>
      {value.slice(at + 1)}
    </>
  );
}

const CHIP = "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition max-sm:px-3 max-sm:text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white max-sm:min-h-10";

/** A supporting fact under the figure; red only for lateness. */
export function HeroChip({ href, icon, tone = "plain", children }: { href?: string; icon?: IconName; tone?: "plain" | "late"; children: ReactNode }) {
  const look = tone === "late" ? "border-transparent bg-[#c4352b] text-white hover:bg-[#b02c23]" : "border-white/20 bg-white/10 text-white hover:bg-white/15";
  const body = (
    <>
      {icon && <Icon name={icon} size={15} className="shrink-0" />}
      <span className="tabular-nums">{children}</span>
      {href && <Icon name="chevron-right" size={13} className="shrink-0 opacity-70" />}
    </>
  );
  return href ? <Link href={href} className={`tactile ${CHIP} ${look}`}>{body}</Link> : <span className={`${CHIP} ${look}`}>{body}</span>;
}

const ROUND = "tactile grid h-14 w-14 place-items-center rounded-full border border-white/20 bg-white/10 transition group-hover:bg-white/20";

/** One of the screen's own actions: a round button with its word under it. A link, or one of the shell's creation sheets. */
export function HeroAction({ href, create, icon, label }: { href?: string; create?: "lease" | "contact" | "payment" | "ticket" | "document"; icon: IconName; label: string }) {
  const body = (
    <>
      <span className={ROUND}><Icon name={icon} size={22} /></span>
      <span className="mt-2 block text-center text-[13px] font-semibold">{label}</span>
    </>
  );
  const cls = "group block w-16 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";
  if (create) return <HeroCreate kind={create} className={cls}>{body}</HeroCreate>;
  return <Link href={href ?? "#"} className={cls}>{body}</Link>;
}

/** A labelled ring: a share, its count in the middle, what it counts beside it. */
export function HeroRing({ fraction, value, label, sub }: { fraction: number; value: string; label: string; sub?: string }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const share = Math.max(0, Math.min(1, fraction));
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-[7.25rem] w-[7.25rem] shrink-0">
        <svg viewBox="0 0 112 112" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="56" cy="56" r={r} fill="none" stroke="rgb(255 255 255 / 0.16)" strokeWidth="10" />
          <circle cx="56" cy="56" r={r} fill="none" stroke="#fff" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${c * share} ${c}`} />
        </svg>
        <p className="absolute inset-0 grid place-items-center font-display text-2xl font-bold tabular-nums">{value}</p>
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        {sub && <p className="mt-0.5 text-sm text-white/70">{sub}</p>}
      </div>
    </div>
  );
}

/** The month, with the way to the one before and the one after. */
export function MonthSwitch({ label, prev, next, prevLabel, nextLabel }: { label: string; prev: string | null; next: string | null; prevLabel: string; nextLabel: string }) {
  const arrow = "grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-white/10 transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
  const off = "grid h-10 w-10 place-items-center rounded-full border border-white/10 text-white/30";
  return (
    <div className="flex shrink-0 items-center gap-2">
      {prev ? <Link href={prev} scroll={false} aria-label={prevLabel} className={`tactile ${arrow}`}><Icon name="chevron-right" size={16} className="rotate-180" /></Link> : <span className={off} aria-hidden><Icon name="chevron-right" size={16} className="rotate-180" /></span>}
      <span className="min-w-[6.5rem] text-center text-sm font-semibold capitalize">{label}</span>
      {next ? <Link href={next} scroll={false} aria-label={nextLabel} className={`tactile ${arrow}`}><Icon name="chevron-right" size={16} /></Link> : <span className={off} aria-hidden><Icon name="chevron-right" size={16} /></span>}
    </div>
  );
}

/** A flat group under the head: a title, its way further, rows on the page's ground. */
export function Section({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="mb-3 flex min-h-8 items-center justify-between gap-3 px-1">
        <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Rows of a flat group: no shadow, hairlines between them. */
export function Rows({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-sand-200/80 overflow-hidden rounded-3xl border border-sand-200/80 bg-white/75">{children}</ul>;
}

/** One row: what, where or when, and the amount or the state in words on the right. */
export function Row({ href, icon, tone = "plain", title, sub, right, rightTone = "plain" }: { href?: string; icon: IconName; tone?: "plain" | "late"; title: string; sub?: string; right?: string; rightTone?: "plain" | "in" | "late" | "soft" }) {
  const well = tone === "late" ? "bg-red-50 text-red-700" : "bg-brand-50 text-brand-700";
  const rightCls = rightTone === "in" ? "text-emerald-700" : rightTone === "late" ? "text-red-700" : rightTone === "soft" ? "text-ink-soft font-medium" : "text-ink";
  const body = (
    <>
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${well}`}><Icon name={icon} size={19} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-ink">{title}</span>
        {sub && <span className="block truncate text-[13px] text-ink-soft">{sub}</span>}
      </span>
      {right && <span className={`shrink-0 text-sm font-semibold tabular-nums ${rightCls}`}>{right}</span>}
      {href && <Icon name="chevron-right" size={16} className="shrink-0 text-ink-soft/70" />}
    </>
  );
  const cls = "flex min-h-[3.75rem] items-center gap-3 px-4 py-2.5";
  return <li>{href ? <Link href={href} className={`${cls} transition hover:bg-brand-50/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600`}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
}

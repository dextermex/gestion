import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/pro/icons";
import GlassHouse from "@/components/gestion/GlassHouse";
import HeroCreate from "@/components/gestion/HeroCreate";

/**
 * The head of a manager screen: one question, answered by one figure, what
 * supports it as chips, and the two to four actions that belong to the
 * screen as a round row. The order is the iPhone app's; the ground is the
 * web's own (the sky card and its glass house), which reads lighter on a
 * wide screen. It is the one raised element of the page; everything under
 * it is a flat list.
 */
export function Hero({ title, eyebrow, top, label, figure, children, actions, aside, art = false }: {
  /** The page's name, for a reader that does not see the layout. */
  title: string;
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
  /** The glass house, at the card's right edge from `sm`. Decoration only: nothing is ever drawn over it. */
  art?: boolean;
}) {
  return (
    <section className="hero-card relative overflow-hidden rounded-[28px] px-5 pb-7 pt-5 text-ink sm:px-9 sm:pb-9 sm:pt-7">
      <h1 className="sr-only">{title}</h1>
      {art && <GlassHouse className="hero-art" />}
      {(eyebrow || top) && (
        <div className="relative mb-5 flex min-h-10 items-center justify-between gap-3">
          <p className="min-w-0 truncate text-[15px] font-medium text-ink-soft">{eyebrow}</p>
          {top}
        </div>
      )}
      <div className={"relative grid grid-cols-1 items-center gap-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-12" + (art ? " lg:pr-[15.5rem]" : "")}>
        <div className="min-w-0 max-lg:text-center">
          <p className="text-[15px] font-medium text-ink-soft">{label}</p>
          <p className="mt-1.5 text-5xl font-semibold leading-none tracking-[-0.045em] tabular-nums text-ink sm:text-6xl">{figure}</p>
          {children && <div className="mt-5 flex flex-wrap items-center gap-2 max-lg:justify-center">{children}</div>}
        </div>
        {/* The ring beside the figure; without one, the screen's actions take its place and the card stays low. */}
        {aside ? <div className="flex justify-center">{aside}</div> : actions ? <div className={ACTIONS}>{actions}</div> : null}
      </div>
      {aside && actions && <div className={`relative mt-7 ${ACTIONS}`}>{actions}</div>}
    </section>
  );
}

const ACTIONS = "flex flex-wrap gap-x-6 gap-y-4 max-lg:justify-center max-sm:gap-x-2";

/** A figure with its euro sign set smaller, the way the app sets large amounts. */
export function Money({ value }: { value: string }) {
  const at = value.indexOf("€");
  if (at < 0) return <>{value}</>;
  return (
    <>
      {value.slice(0, at)}
      <span className="text-[0.62em] font-semibold tracking-normal">€</span>
      {value.slice(at + 1)}
    </>
  );
}

const CHIP = "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition max-sm:px-3 max-sm:text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 max-sm:min-h-10";

/** A supporting fact under the figure; red only for lateness. */
export function HeroChip({ href, icon, tone = "plain", children }: { href?: string; icon?: IconName; tone?: "plain" | "late"; children: ReactNode }) {
  const look = tone === "late" ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100" : "border-white bg-white/80 text-ink hover:bg-white";
  const body = (
    <>
      {icon && <Icon name={icon} size={15} className={"shrink-0 " + (tone === "late" ? "" : "text-brand-700")} />}
      <span className="tabular-nums">{children}</span>
      {href && <Icon name="chevron-right" size={13} className="shrink-0 opacity-60" />}
    </>
  );
  return href ? <Link href={href} className={`tactile ${CHIP} ${look}`}>{body}</Link> : <span className={`${CHIP} ${look}`}>{body}</span>;
}

/**
 * What came in or went out, under the figure: a tinted arrow, the word, the
 * amount, and what is still open under it. Green for money in; a soft red
 * for money out, so the two read apart at a glance.
 */
export function HeroStat({ href, tone, label, value, sub }: { href?: string; tone: "in" | "out"; label: string; value: string; sub?: string }) {
  const body = (
    <>
      <span className={"grid h-11 w-11 shrink-0 place-items-center rounded-full " + (tone === "in" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
        <Icon name={tone === "in" ? "arrow-in" : "arrow-out"} size={20} />
      </span>
      <span className="min-w-0 text-left">
        <span className="block text-[13px] font-medium text-ink-soft">{label}</span>
        <span className="block text-xl font-semibold tracking-tight tabular-nums text-ink">{value}</span>
        {sub && <span className="block text-[13px] tabular-nums text-ink-soft">{sub}</span>}
      </span>
    </>
  );
  const cls = "flex min-w-0 items-center gap-3 rounded-2xl px-1 py-1";
  return href ? <Link href={href} className={`tactile ${cls} transition hover:bg-white/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600`}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** The round button of a screen's action row; shared with the controls that open their own sheet. */
export const HERO_ROUND = "hero-round tactile grid h-14 w-14 place-items-center rounded-full bg-white text-brand-700 transition";
export const HERO_ACTION = "group block w-16 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600";
export const HERO_ACTION_LABEL = "mt-2 block text-center text-[13px] font-semibold text-ink-soft transition group-hover:text-ink";

/** One of the screen's own actions: a round button with its word under it. A link, or one of the shell's creation sheets. */
export function HeroAction({ href, create, icon, label }: { href?: string; create?: "lease" | "contact" | "payment" | "ticket" | "document"; icon: IconName; label: string }) {
  const body = (
    <>
      <span className={HERO_ROUND}><Icon name={icon} size={22} /></span>
      <span className={HERO_ACTION_LABEL}>{label}</span>
    </>
  );
  if (create) return <HeroCreate kind={create} className={HERO_ACTION}>{body}</HeroCreate>;
  return <Link href={href ?? "#"} className={HERO_ACTION}>{body}</Link>;
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
          <circle cx="56" cy="56" r={r} fill="none" stroke="rgb(16 80 92 / 0.12)" strokeWidth="10" />
          <circle cx="56" cy="56" r={r} fill="none" stroke="#10505c" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${c * share} ${c}`} />
        </svg>
        <p className="absolute inset-0 grid place-items-center text-2xl font-semibold tracking-tight tabular-nums text-ink">{value}</p>
      </div>
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-ink">{label}</p>
        {sub && <p className="mt-0.5 text-sm text-ink-soft">{sub}</p>}
      </div>
    </div>
  );
}

/** The month, with the way to the one before and the one after. */
export function MonthSwitch({ label, prev, next, prevLabel, nextLabel }: { label: string; prev: string | null; next: string | null; prevLabel: string; nextLabel: string }) {
  const arrow = "grid h-10 w-10 place-items-center rounded-full border border-white bg-white/80 text-ink transition hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";
  const off = "grid h-10 w-10 place-items-center rounded-full border border-white/60 text-ink-soft/40";
  return (
    <div className="flex shrink-0 items-center gap-2">
      {prev ? <Link href={prev} scroll={false} aria-label={prevLabel} className={`tactile ${arrow}`}><Icon name="chevron-right" size={16} className="rotate-180" /></Link> : <span className={off} aria-hidden><Icon name="chevron-right" size={16} className="rotate-180" /></span>}
      <span className="min-w-[6.5rem] text-center text-sm font-semibold capitalize text-ink">{label}</span>
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
        <span className="line-clamp-2 text-[15px] font-semibold leading-snug text-ink">{title}</span>
        {sub && <span className="block truncate text-[13px] text-ink-soft">{sub}</span>}
      </span>
      {right && <span className={`shrink-0 text-sm font-semibold tabular-nums ${rightCls}`}>{right}</span>}
      {href && <Icon name="chevron-right" size={16} className="shrink-0 text-ink-soft/70" />}
    </>
  );
  const cls = "flex min-h-[3.75rem] items-center gap-3 px-4 py-2.5";
  return <li>{href ? <Link href={href} className={`${cls} transition hover:bg-brand-50/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600`}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
}

/** A group's heading with its total, as the app writes it ("Août 2026 · 3.530 €"). */
export function GroupHead({ id, title, total, tone = "plain" }: { id?: string; title: string; total?: string; tone?: "plain" | "late" }) {
  return (
    <div id={id} className="mb-2 mt-7 flex scroll-mt-24 items-baseline justify-between gap-3 px-1 first:mt-0">
      <h2 className="text-sm font-semibold text-ink-soft">{title}</h2>
      {total && <p className={"text-sm font-semibold tabular-nums " + (tone === "late" ? "text-red-700" : "text-ink-soft")}>{total}</p>}
    </div>
  );
}

/**
 * A row that opens on what belongs to it: a person or an object, where, its
 * state in words, the amount on the right and one action at most. What the
 * row can do (the reminder ladder, its papers) waits inside, so the list
 * stays a list.
 */
export function FoldRow({ id, open, initials, icon, attrs, tone = "plain", title, sub, right, rightSub, rightTone = "plain", action, children }: {
  id?: string;
  open?: boolean;
  /** A person's initials, or an object's symbol. */
  initials?: string;
  icon?: IconName;
  /** Data attributes for the row (the hooks a test or a script finds it by). */
  attrs?: Record<`data-${string}`, string>;
  tone?: "plain" | "late" | "quiet";
  title: string;
  sub: string;
  right: string;
  rightSub?: string;
  rightTone?: "plain" | "late" | "soft" | "in";
  /** The row's one action, in a word ("Relancer"). */
  action?: string;
  children: ReactNode;
}) {
  const badge = tone === "late" ? "bg-red-50 text-red-700" : tone === "quiet" ? "bg-sand-100 text-ink-soft" : "bg-brand-50 text-brand-800";
  const amount = rightTone === "late" ? "text-red-700" : rightTone === "soft" ? "text-ink-soft" : rightTone === "in" ? "text-emerald-700" : "text-ink";
  return (
    <li id={id} className="scroll-mt-24" {...attrs}>
      <details className="group" open={open}>
        <summary className="flex min-h-[4.25rem] cursor-pointer list-none items-center gap-3 px-4 py-3 transition hover:bg-brand-50/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 [&::-webkit-details-marker]:hidden">
          <span className={`grid h-10 w-10 shrink-0 place-items-center text-xs font-bold ${icon ? "rounded-2xl" : "rounded-full"} ${badge}`}>{icon ? <Icon name={icon} size={19} /> : initials || "·"}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold text-ink">{title}</span>
            <span className="block truncate text-[13px] text-ink-soft">{sub}</span>
          </span>
          <span className="shrink-0 text-right">
            <span className={`block text-[15px] font-semibold tabular-nums ${amount}`}>{right}</span>
            {rightSub && <span className="block text-xs text-ink-soft">{rightSub}</span>}
          </span>
          {action && <span className="hidden shrink-0 rounded-full bg-brand-700 px-3.5 py-1.5 text-[13px] font-semibold text-white group-open:bg-brand-50 group-open:text-brand-800 sm:inline-block">{action}</span>}
          <Icon name="chevron-right" size={16} className="shrink-0 text-ink-soft/70 transition-transform group-open:rotate-90" />
        </summary>
        <div className="border-t border-sand-200/70 bg-sand-50/50 px-4 py-4 sm:pl-[4.25rem]">{children}</div>
      </details>
    </li>
  );
}

/** What was done and what comes next, as a line of dated steps. */
export function Steps({ label, children }: { label: string; children: ReactNode }) {
  return <ol aria-label={label} className="relative ml-1.5 space-y-3.5 border-l border-sand-300 pl-5">{children}</ol>;
}

export function Step({ state, title, date, children }: { state: "done" | "next"; title: string; date?: string; children?: ReactNode }) {
  return (
    <li className="relative">
      <span className={"absolute -left-[1.6rem] top-1 h-2.5 w-2.5 rounded-full " + (state === "done" ? "bg-brand-700" : "border-2 border-brand-700 bg-white")} aria-hidden />
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className={"text-sm " + (state === "next" ? "font-semibold text-ink" : "text-ink")}>{title}</p>
        {date && <p className="text-[13px] tabular-nums text-ink-soft">{date}</p>}
      </div>
      {children}
    </li>
  );
}

/** The views of a screen as one quiet control, each an address of its own, with a count where one helps. */
export function Segments({ label, items }: { label: string; items: Array<{ href: string; label: string; count?: number; current: boolean }> }) {
  return (
    <nav aria-label={label} className="scroll-x -mx-1 flex px-1">
      <div className="inline-flex gap-1 rounded-2xl border border-sand-200/80 bg-white/70 p-1">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            scroll={false}
            aria-current={it.current ? "page" : undefined}
            className={"tactile inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 " + (it.current ? "bg-brand-700 text-white shadow-sm" : "text-ink-soft hover:text-ink")}
          >
            {it.label}
            {it.count !== undefined && <span className={"tabular-nums text-xs " + (it.current ? "text-white/75" : "text-ink-soft/80")}>{it.count}</span>}
          </Link>
        ))}
      </div>
    </nav>
  );
}

import Link from "next/link";
import { Icon, type IconName } from "@/components/pro/icons";

/**
 * A shelf of tools or reports: groups under a heading with their count,
 * each entry a card of a symbol, a name and one line, the way to it on the
 * right. What is not built yet is said so on its card and leads nowhere.
 * One tint for every symbol: colour is kept for money in and lateness.
 */
export interface ToolItem {
  key: string;
  icon: IconName;
  title: string;
  description: string;
  /** Where it opens; none while it is not built. */
  href?: string;
  /** Opens outside the app (the public site), in a new tab. */
  external?: boolean;
}

export interface ToolGroup {
  key: string;
  title: string;
  countLabel: string;
  items: ToolItem[];
}

export default function ToolGrid({ groups, soonLabel, externalLabel }: { groups: ToolGroup[]; soonLabel: string; externalLabel: string }) {
  return (
    <div className="space-y-9">
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`tools-${g.key}`}>
          <div className="mb-3 flex items-center gap-2.5 px-1">
            <h2 id={`tools-${g.key}`} className="font-display text-lg font-bold text-ink">{g.title}</h2>
            <span className="rounded-full border border-sand-200/80 bg-white/70 px-2.5 py-0.5 text-xs font-semibold text-ink-soft">{g.countLabel}</span>
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {g.items.map((it) => {
              const body = (
                <>
                  <span className={"grid h-11 w-11 shrink-0 place-items-center rounded-2xl " + (it.href ? "bg-brand-50 text-brand-700" : "bg-sand-100 text-ink-soft")}>
                    <Icon name={it.icon} size={21} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[15px] font-semibold text-ink">{it.title}</span>
                      {!it.href && <span className="text-xs font-medium text-ink-soft">{soonLabel}</span>}
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-snug text-ink-soft">{it.description}</span>
                  </span>
                  {it.href && (
                    <>
                      {it.external && <span className="sr-only">{externalLabel}</span>}
                      <Icon name={it.external ? "external" : "chevron-right"} size={16} className="mt-1 shrink-0 text-ink-soft/70" />
                    </>
                  )}
                </>
              );
              const card = "flex h-full min-h-[5.5rem] items-start gap-3.5 rounded-3xl border p-4";
              return (
                <li key={it.key} className="min-w-0">
                  {!it.href ? (
                    <div className={`${card} border-dashed border-sand-300 bg-sand-50/50`} aria-disabled="true">{body}</div>
                  ) : it.external ? (
                    <a href={it.href} target="_blank" rel="noreferrer" className={`tactile ${card} border-sand-200/80 bg-white/75 transition hover:border-brand-200 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600`}>{body}</a>
                  ) : (
                    <Link href={it.href} className={`tactile ${card} border-sand-200/80 bg-white/75 transition hover:border-brand-200 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600`}>{body}</Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

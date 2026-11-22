import Link from "next/link";
import { Icon } from "@/components/pro/icons";

/** What a `not-found.tsx` renders: the address leads nowhere, and where to go from here. */
export default function RouteNotFound({ title, body, links, standalone = false }: { title: string; body: string; links: Array<{ href: string; label: string }>; standalone?: boolean }) {
  return (
    <div className={"ui-empty flex flex-col items-center justify-center gap-3 rounded-2xl border border-sand-200 bg-white px-6 py-16 text-center" + (standalone ? " mx-auto mt-[12vh] max-w-lg" : "")}>
      <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-white text-brand-600 shadow-sm">
        <Icon name="search" size={22} />
      </span>
      <h1 className="font-display text-xl font-bold text-ink">{title}</h1>
      <p className="max-w-sm text-sm text-ink-soft">{body}</p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
        {links.map((l, i) => (
          <Link
            key={l.href}
            href={l.href}
            className={
              i === 0
                ? "ui-button inline-flex min-h-11 items-center justify-center rounded-full bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                : "inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            }
          >
            {l.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

import type { Dict } from "@/lib/i18n/fr";

/** Shown when the signed-in account is not a tenant on any lease. */
export default function TenantEmpty({ d }: { d: Dict }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-sand-100 text-ink-soft">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-6 w-6" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 11.2 12 4l9 7.2M5.5 9.6V20h13V9.6" />
        </svg>
      </span>
      <h2 className="mt-5 font-display text-lg font-bold text-ink">{d.tenant.emptyTitle}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">{d.tenant.emptyBody}</p>
    </div>
  );
}

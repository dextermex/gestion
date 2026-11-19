import Link from "next/link";
import CopyButton from "@/components/gestion/CopyButton";
import { Icon } from "@/components/pro/icons";
import { Card } from "@/components/pro/ui";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { getTenantView } from "@/lib/portal/space";

/**
 * "Aide": how to reach the manager, from "Plus" on a phone. Everything on
 * it is read from the tenancy: the manager's name, and the e-mail and the
 * telephone only when the manager's record carries them. Nothing is added
 * that the record does not hold (no emergency line is stored anywhere, so
 * none is shown). The two ways the space itself offers, a message and a
 * request, sit under the contact.
 */
export default async function TenantHelpPage() {
  const { d } = await getI18n();
  const view = await getTenantView();
  if (view.kind === "signed_out") return null;
  const { space } = view;
  const t = d.tenant;
  const lease = space.current ?? space.past[0] ?? null;
  const live = space.current !== null;

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{t.helpTitle}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t.helpSub}</p>
      </div>

      <Card className="crm-panel p-5" data-help-managers>
        <h2 className="font-display text-lg font-bold text-ink">{t.helpManagers}</h2>
        {space.managers.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">{t.helpNoManager}</p>
        ) : (
          <ul className="mt-3 divide-y divide-sand-100">
            {space.managers.map((m) => (
              <li key={m.orgId} className="py-3 first:pt-0 last:pb-0">
                <p className="font-display text-sm font-bold text-ink">{m.name}</p>
                {m.email && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                    <p className="min-w-0 text-sm text-ink [overflow-wrap:anywhere]">{m.email}</p>
                    <CopyButton value={m.email} label={t.copy} copiedLabel={t.copied} ariaLabel={fmt(t.copyAria, { what: m.email })} />
                  </div>
                )}
                {m.phone && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                    <p className="text-sm tabular-nums text-ink">{m.phone}</p>
                    <a href={`tel:${m.phone.replace(/\s/g, "")}`} className="tactile inline-flex min-h-11 items-center gap-2 rounded-xl border border-sand-200 bg-white px-3.5 text-sm font-semibold text-brand-700 transition hover:border-brand-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
                      <Icon name="phone" size={18} className="shrink-0" />
                      {t.managerCall}
                    </a>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {lease && (
        <Card className="crm-panel p-5">
          <p className="text-sm leading-relaxed text-ink-soft">{t.helpRequestHint}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/locataire/messages" className="tactile inline-flex min-h-11 items-center gap-2 rounded-xl border border-sand-200 bg-white px-3.5 text-sm font-semibold text-brand-700 transition hover:border-brand-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
              <Icon name="messages" size={18} className="shrink-0" />
              {t.managerWrite}
            </Link>
            {live && (
              <Link href="/locataire/demandes?nouvelle=1" className="tactile inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-3.5 text-sm font-semibold text-white transition hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
                <Icon name="inbox" size={18} className="shrink-0" />
                {t.quickRequest}
              </Link>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

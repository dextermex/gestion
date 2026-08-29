import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { DemoAction } from "@/components/gestion/DemoAction";
import SaltEdgeConnect from "@/components/gestion/SaltEdgeConnect";
import SyncBank from "@/components/gestion/SyncBank";
import { getDatasetId, getDemo } from "@/lib/demo";
import { saltEdgeConfigured } from "@/lib/banking/saltedge";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { MORADA_URL, PRO_URL } from "@/lib/constants";

/**
 * Intégrations: the connections this workspace actually has. Only what is
 * wired appears here — an integration with no backend has no card.
 */
export default async function IntegrationsPage() {
  const { d } = await getI18n();
  const [{ BANK_ACCOUNTS }, datasetId] = await Promise.all([getDemo(), getDatasetId()]);
  const real = datasetId === "real";
  const configured = saltEdgeConfigured();
  const linked = BANK_ACCOUNTS;

  return (
    <div>
      <PageHeader title={d.integrations.title} subtitle={d.integrations.subtitle} />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-ink">{d.integrations.saltName}</h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">{d.integrations.saltBody}</p>
            </div>
            {linked.length > 0 ? (
              <Badge className="bg-emerald-100 text-emerald-800">{d.integrations.connected}</Badge>
            ) : configured || !real ? (
              <Badge className="bg-sand-100 text-ink-soft">{d.integrations.notConnected}</Badge>
            ) : (
              <Badge className="bg-amber-100 text-amber-800">{d.banque.connectNotConfigured}</Badge>
            )}
          </div>
          <p className="mt-3 text-sm tabular-nums text-ink">
            {linked.length > 0
              ? fmt(d.integrations.saltAccounts, { n: linked.length })
              : d.integrations.saltNone}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {real ? (
              <>
                <SaltEdgeConnect
                  label={`+ ${d.banque.connectAccount}`}
                  notConfigured={d.banque.connectNotConfigured}
                  failed={d.banque.connectFailed}
                />
                {linked.length > 0 && (
                  <SyncBank
                    label={d.banque.retrieve}
                    labels={{
                      notConfigured: d.banque.connectNotConfigured,
                      failed: d.banque.syncFailed,
                      schemaUnexposed: d.banque.schemaUnexposed,
                    }}
                  />
                )}
              </>
            ) : (
              <DemoAction label={`+ ${d.banque.connectAccount}`} doneMessage={d.banque.connectDone} />
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-display text-lg font-bold text-ink">{d.integrations.ecosystemTitle}</h2>
          <ul className="mt-3 space-y-3">
            <li className="flex items-center justify-between gap-3 rounded-xl border border-sand-200 p-3.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">Morada</p>
                <p className="text-xs text-ink-soft">{d.integrations.moradaBody}</p>
              </div>
              <a
                href={MORADA_URL}
                className="shrink-0 text-sm font-semibold text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                {d.integrations.open}
              </a>
            </li>
            <li className="flex items-center justify-between gap-3 rounded-xl border border-sand-200 p-3.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">Morada Pro</p>
                <p className="text-xs text-ink-soft">{d.integrations.proBody}</p>
              </div>
              <a
                href={PRO_URL}
                className="shrink-0 text-sm font-semibold text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                {d.integrations.open}
              </a>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

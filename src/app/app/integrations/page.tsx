import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { DemoAction } from "@/components/gestion/DemoAction";
import SaltEdgeConnect from "@/components/gestion/SaltEdgeConnect";
import SyncBank from "@/components/gestion/SyncBank";
import { getDatasetId, getDemo } from "@/lib/demo";
import { connectLabels, syncLabels } from "@/lib/banking/labels";
import { saltEdgeConfigured } from "@/lib/banking/saltedge";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { MORADA_URL, PRO_URL } from "@/lib/constants";
import { signatureProvider, signatureProviderLabel } from "@/lib/signature/provider";
import Link from "next/link";

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
  const signature = signatureProvider();

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
          {/* A real account opens the real consent journey; a sample cabinet opens
              the same journey on the fake bank when the credentials are there. */}
          <div className="mt-4 flex flex-wrap items-start gap-2">
            {real || configured ? (
              <>
                <SaltEdgeConnect label={`+ ${d.banque.connectAccount}`} labels={connectLabels(d)} hint={real ? undefined : d.banque.connectDemo} />
                {real && linked.length > 0 && <SyncBank label={d.banque.retrieve} labels={syncLabels(d)} />}
              </>
            ) : (
              <DemoAction label={`+ ${d.banque.connectAccount}`} doneMessage={d.banque.connectDone} />
            )}
          </div>
        </Card>

        {/* The signature seam: which provider the deployment carries, and what the register does meanwhile. */}
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-ink">{d.integrations.signatureName}</h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">{d.integrations.signatureBody}</p>
            </div>
            {signature.configured ? (
              <Badge className="bg-emerald-100 text-emerald-800">{d.integrations.connected}</Badge>
            ) : (
              <Badge className="bg-sand-100 text-ink-soft">{d.integrations.notConnected}</Badge>
            )}
          </div>
          <p className="mt-3 text-sm text-ink">
            {signature.provider ? fmt(d.contrats.signatureOn, { provider: signatureProviderLabel(signature.provider) }) : d.integrations.signatureOffBody}
          </p>
          <Link href="/app/contrats" className="mt-4 inline-flex min-h-10 items-center text-sm font-semibold text-brand-700 hover:underline">
            {d.contrats.registryTitle}
          </Link>
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
                className="shrink-0 text-sm font-semibold text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 max-sm:inline-flex max-sm:min-h-10 max-sm:items-center"
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
                className="shrink-0 text-sm font-semibold text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 max-sm:inline-flex max-sm:min-h-10 max-sm:items-center"
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

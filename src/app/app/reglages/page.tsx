import Link from "next/link";
import { PageHeader } from "@/components/pro/ui";
import HubTabs from "@/components/gestion/HubTabs";
import { LegalNote, Panel } from "@/components/gestion/bits";
import { getDemo } from "@/lib/demo";
import { getIdentity } from "@/lib/workspace";
import { formatDate } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { paramsInForce } from "@/domain/legal/params";

/**
 * Réglages: the workspace itself, and the registries every calculation
 * relies on. The cabinet rows (autorisation, RC insurance, VAT) render only
 * when the dataset carries them — a real account that has not filled its
 * profile simply shows fewer rows, never placeholders.
 */
export default async function ReglagesPage() {
  const { locale, d } = await getI18n();
  const { ORG, TODAY } = await getDemo();
  const identity = await getIdentity();

  // The legal-parameters registry moved here from Conformité: it governs
  // the calculations of the whole workspace, so it lives with the workspace.
  const params = paramsInForce(TODAY);
  const uncertain = params.filter((p) => p.status === "uncertain");

  const rows: Array<{ label: string; value: string }> = [
    { label: d.reglages.workspaceName, value: ORG.name },
    {
      label: d.reglages.workspaceKind,
      value: ORG.kind === "owner" ? d.reglages.kindOwner : d.reglages.kindCabinet,
    },
  ];
  if (identity) {
    rows.push({
      label: d.reglages.signedInAs,
      value: `${identity.displayName} · ${identity.email}`,
    });
  }
  if (ORG.autorisationNumber) {
    rows.push({
      label: d.reglages.autorisation,
      value: fmt(d.reglages.autorisationValue, {
        num: ORG.autorisationNumber,
        date: formatDate(ORG.autorisationExpiry, locale),
      }),
    });
  }
  if (ORG.piInsuranceProvider) {
    rows.push({
      label: d.reglages.piInsurance,
      value: fmt(d.reglages.piInsuranceValue, {
        provider: ORG.piInsuranceProvider,
        date: formatDate(ORG.piInsuranceExpiry, locale),
      }),
    });
  }
  if (ORG.vatNumber) rows.push({ label: d.reglages.vat, value: ORG.vatNumber });

  const registries = [{ href: "/app/banque", title: d.reglages.bankLink, body: d.reglages.bankBody }];

  return (
    <div>
      <HubTabs d={d} hub="reglages" active="/app/reglages" workspaceKind={ORG.kind} />
      <PageHeader title={d.reglages.title} subtitle={d.reglages.subtitle} />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <Panel title={d.reglages.workspaceTitle}>
          <dl className="divide-y divide-sand-100">
            {rows.map((r) => (
              <div key={r.label} className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="shrink-0 text-sm text-ink-soft">{r.label}</dt>
                <dd className="min-w-0 text-right text-sm font-semibold text-ink">{r.value}</dd>
              </div>
            ))}
          </dl>
          {ORG.autorisationNumber !== "" && <LegalNote>{d.conformite.orgLegal}</LegalNote>}
        </Panel>

        <div className="flex flex-col gap-5">
        <Panel title={fmt(d.conformite.paramsTitle, { n: params.length })}>
          <p className="text-sm leading-relaxed text-ink-soft">{d.conformite.paramsBody}</p>
          <div className="mt-3 rounded-xl bg-sand-50 p-3.5">
            <p className="text-xs font-semibold text-ink">
              {fmt(d.conformite.paramsUncertain, { n: uncertain.length })}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">{d.conformite.paramsFoot}</p>
          </div>
        </Panel>

        <Panel title={d.reglages.registriesTitle}>
          <div className="space-y-3">
            {registries.map((r) => (
              <Link
                key={r.href}
                href={r.href}
                className="tactile block rounded-xl border border-sand-200 p-4 transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-brand-200 hover:bg-sand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                <p className="text-sm font-semibold text-brand-700">{r.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-soft">{r.body}</p>
              </Link>
            ))}
          </div>
        </Panel>
        </div>
      </div>
    </div>
  );
}

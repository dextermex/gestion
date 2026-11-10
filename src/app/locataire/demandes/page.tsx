import { Card } from "@/components/pro/ui";
import { LinkRow, MetaBadge } from "@/components/gestion/bits";
import TenantEmpty from "@/components/gestion/TenantEmpty";
import TenantRequests, { type RequestPreset } from "@/components/gestion/TenantRequests";
import { requestLabels } from "@/lib/portal/labels";
import { getDemo } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { getTenantView } from "@/lib/portal/space";
import { formatDate, formatMonth, requestStateMeta } from "@/lib/types";

/**
 * "Demandes": every request the tenant raised on their leases, newest
 * first, and the door to a new one. A request is an intervention on the
 * owner's side; the three states here follow the intervention's own.
 */
export default async function TenantRequestsPage({ searchParams }: { searchParams: Promise<{ nouvelle?: string; mois?: string }> }) {
  const params = await searchParams;
  const { locale, d } = await getI18n();
  const view = await getTenantView();
  if (view.kind === "signed_out") return null;
  const { space, sample } = view;
  const lease = space.current ?? space.past[0];
  if (!lease) return <TenantEmpty d={d} manage={view.canManage} />;
  const stateMeta = requestStateMeta(d);
  const kindLabel = { technical: d.tenant.kindTechnical, document: d.tenant.kindDocument, question: d.tenant.kindQuestion, other: d.tenant.kindOther };
  // A link from elsewhere in the space may open the form on its way: the certificate to send,
  // a month's receipt to ask for, a correction to the file. Anything else opens the plain form.
  const month = typeof params.mois === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.mois) ? params.mois : null;
  const preset: RequestPreset | null =
    params.nouvelle === "attestation"
      ? { kind: "other", title: d.tenant.presetCertTitle, heading: d.tenant.presetCertHeading, hint: d.tenant.presetCertHint }
      : params.nouvelle === "quittance" && month
        ? { kind: "document", title: fmt(d.tenant.presetReceiptTitle, { month: formatMonth(month, locale) }), heading: d.tenant.presetReceiptHeading, hint: null }
        : params.nouvelle === "correction"
          ? { kind: "question", title: d.tenant.presetCorrectionTitle, heading: d.tenant.presetCorrectionHeading, hint: d.tenant.presetCorrectionHint }
          : null;
  const sampleNote = sample ? fmt(d.shell.sampleBanner, { cabinet: (await getDemo()).ORG.shortName }) : null;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{d.tenant.reqTitle}</h1>
          <p className="mt-1 text-sm text-ink-soft">{d.tenant.reqSub}</p>
        </div>
        <TenantRequests
          // A different door (another preset, another month) starts the form over.
          key={`${params.nouvelle ?? ""}:${month ?? ""}`}
          labels={requestLabels(d)}
          canCreate={space.current !== null}
          sampleNote={sampleNote}
          initialOpen={params.nouvelle !== undefined}
          preset={preset}
        />
      </div>

      <h2 className="mb-3 font-display text-lg font-bold text-ink">{d.tenant.reqListTitle}</h2>
      <Card className="px-4">
        {space.requests.length === 0 ? (
          <div className="py-10 text-center">
            <p className="font-display text-base font-bold text-ink">{d.tenant.reqEmptyTitle}</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-ink-soft">{d.tenant.reqEmptyBody}</p>
          </div>
        ) : (
          <ul className="divide-y divide-sand-100">
            {space.requests.map((r) => (
              <li key={r.id}>
                <LinkRow
                  href={`/locataire/demandes/${r.id}`}
                  title={r.title}
                  sub={`${kindLabel[r.kind]} · ${r.ref} · ${formatDate(r.createdAt, locale)}`}
                  right={<MetaBadge meta={stateMeta[r.state]} />}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

import { Card } from "@/components/pro/ui";
import { LinkRow, MetaBadge } from "@/components/gestion/bits";
import TenantEmpty from "@/components/gestion/TenantEmpty";
import TenantRequests from "@/components/gestion/TenantRequests";
import { requestLabels } from "@/lib/portal/labels";
import { getDemo } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { getTenantView } from "@/lib/portal/space";
import { formatDate, requestStateMeta } from "@/lib/types";

/**
 * "Demandes": every request the tenant raised on their leases, newest
 * first, and the door to a new one. A request is an intervention on the
 * owner's side; the three states here follow the intervention's own.
 */
export default async function TenantRequestsPage({ searchParams }: { searchParams: Promise<{ nouvelle?: string }> }) {
  const params = await searchParams;
  const { locale, d } = await getI18n();
  const view = await getTenantView();
  if (view.kind === "signed_out") return null;
  const { space, sample } = view;
  const lease = space.current ?? space.past[0];
  if (!lease) return <TenantEmpty d={d} manage={view.canManage} />;
  const stateMeta = requestStateMeta(d);
  const kindLabel = { technical: d.tenant.kindTechnical, document: d.tenant.kindDocument, question: d.tenant.kindQuestion, other: d.tenant.kindOther };
  const sampleNote = sample ? fmt(d.shell.sampleBanner, { cabinet: (await getDemo()).ORG.shortName }) : null;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{d.tenant.reqTitle}</h1>
          <p className="mt-1 text-sm text-ink-soft">{d.tenant.reqSub}</p>
        </div>
        <TenantRequests labels={requestLabels(d)} canCreate={space.current !== null} sampleNote={sampleNote} initialOpen={params.nouvelle !== undefined} />
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

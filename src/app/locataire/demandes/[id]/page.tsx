import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card } from "@/components/pro/ui";
import { MetaBadge, Panel } from "@/components/gestion/bits";
import TenantThread from "@/components/gestion/TenantThread";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { getTenantView } from "@/lib/portal/space";
import { formatDate, requestStateMeta, ticketSeverityMeta } from "@/lib/types";

/**
 * One request: what was asked, the photos, and the thread with the
 * manager. The request comes from the tenant's own space, so an id that is
 * not theirs is simply not found: the database never returned it.
 */
export default async function TenantRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { locale, d } = await getI18n();
  const view = await getTenantView();
  if (view.kind === "signed_out") return null;
  const { space, sample } = view;
  const request = space.requests.find((r) => r.id === id);
  if (!request) notFound();
  const stateMeta = requestStateMeta(d);
  const severityMeta = ticketSeverityMeta(d) as Record<string, { label: string; color: string }>;
  const kindLabel = { technical: d.tenant.kindTechnical, document: d.tenant.kindDocument, question: d.tenant.kindQuestion, other: d.tenant.kindOther }[request.kind];
  const categoryLabel: Record<string, string> = {
    heating: d.tenant.catHeating,
    plumbing: d.tenant.catPlumbing,
    electrics: d.tenant.catElectric,
    damp_mould: d.tenant.catDamp,
    locks_keys: d.tenant.catLock,
    appliances: d.tenant.catAppliances,
    gas: d.tenant.catGas,
    other: d.tenant.catOther,
  };

  return (
    <div className="space-y-5">
      <div>
        <Link href="/locataire/demandes" className="text-sm font-semibold text-brand-700 hover:underline">
          {d.tenant.reqBack}
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{request.title}</h1>
            <p className="mt-1 text-sm text-ink-soft">
              {kindLabel}
              {request.kind === "technical" && categoryLabel[request.category] && ` · ${categoryLabel[request.category]}`}
              {` · ${fmt(d.tenant.reqRef, { ref: request.ref })}`}
            </p>
          </div>
          <MetaBadge meta={stateMeta[request.state]} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge>{fmt(d.tenant.reqOpenedOn, { date: formatDate(request.createdAt, locale) })}</Badge>
          {request.state === "resolved" && request.closedAt && <Badge>{fmt(d.tenant.reqResolvedOn, { date: formatDate(request.closedAt, locale) })}</Badge>}
          {request.kind === "technical" && severityMeta[request.severity] && <MetaBadge meta={severityMeta[request.severity]} />}
        </div>
      </div>

      {request.description && (
        <Card className="p-5">
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{request.description}</p>
        </Card>
      )}

      {request.attachments.length > 0 && (
        <Panel title={d.tenant.attachments}>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {request.attachments.map((a) => (
              <li key={a.id} className="overflow-hidden rounded-xl border border-sand-200 bg-sand-50">
                {a.url ? (
                  <a href={a.url} target="_blank" rel="noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.url} alt={a.name} className="aspect-square w-full object-cover" />
                  </a>
                ) : (
                  <p className="p-3 text-xs text-ink-soft">{a.name}</p>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={d.tenant.threadTitle}>
        {request.messages.length === 0 ? (
          <p className="text-sm text-ink-soft">{d.tenant.threadEmpty}</p>
        ) : (
          <ul className="space-y-3">
            {request.messages.map((m) => (
              <li key={m.id} className={"max-w-[85%] rounded-2xl px-4 py-3 " + (m.mine ? "ml-auto bg-brand-50" : "bg-sand-50")}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                  {m.mine ? d.tenant.threadYou : m.senderKind === "tenant" ? "" : d.tenant.threadManager}
                  {` · ${formatDate(m.sentAt.slice(0, 10), locale)}`}
                </p>
                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink">{m.body}</p>
              </li>
            ))}
          </ul>
        )}
        {!sample && (
          <TenantThread
            requestId={request.id}
            labels={{ write: d.tenant.threadWrite, send: d.tenant.threadSend, sent: d.tenant.threadSent, failed: d.tenant.threadFailed }}
          />
        )}
      </Panel>
    </div>
  );
}

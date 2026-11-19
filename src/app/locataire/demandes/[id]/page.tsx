import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/pro/icons";
import { Badge, Card } from "@/components/pro/ui";
import { MetaBadge, Panel } from "@/components/gestion/bits";
import TenantAddPhotos from "@/components/gestion/TenantAddPhotos";
import TenantReply from "@/components/gestion/TenantReply";
import { getDemo } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { momentShort, visitWhen } from "@/lib/portal/format";
import { getTenantView } from "@/lib/portal/space";
import { requestTimeline } from "@/lib/portal/view";
import { formatDate, requestStateMeta, ticketSeverityMeta } from "@/lib/types";

/**
 * One request: what was asked, where it stands, the photos, and the last
 * words exchanged about it. The follow-up is the ticket's own status and
 * dates (sent, taken on, the visit, closed); a planned visit shows its day
 * and hour only when the database hands them over. The request comes from
 * the tenant's own space, so an id that is not theirs is simply not found:
 * the database never returned it.
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
  const sampleNote = sample ? fmt(d.shell.sampleBanner, { cabinet: (await getDemo()).ORG.shortName }) : null;
  const open = request.state === "sent" || request.state === "in_progress";
  // Writing (a photo, a reply) needs the tenancy in force: the database refuses it otherwise.
  const live = space.current?.id === request.leaseId || space.others.some((l) => l.id === request.leaseId);

  const steps = requestTimeline(request);
  const stepLabel = { sent: d.tenant.stepSent, taken: d.tenant.stepTaken, slot: d.tenant.stepSlot, visit: d.tenant.stepVisit, resolved: d.tenant.stepResolved, refused: d.tenant.stepRefused };
  const visit = request.visit;
  const visitAhead = open && visit !== null && visit.scheduledAt.slice(0, 10) >= space.today;
  const when = visit ? visitWhen(visit.scheduledAt, locale) : null;

  // The last words about it: what was said in its conversation since the request was sent.
  const conversation = space.conversations.find((c) => c.id === request.conversationId) ?? space.conversations.find((c) => c.leaseId === request.leaseId) ?? null;
  const anchorAt = conversation?.messages.find((m) => m.ticketId === request.id)?.sentAt ?? request.createdAt;
  const managerName = space.managers.map((m) => m.name).filter(Boolean).join(" · ") || d.tenant.managerTitle;
  // A step's date as its row gives it: with the hour when the row carries one, and said to be an update when that is all the row knows.
  const stepWhen = (step: (typeof steps)[number]): string => {
    const at = step.key === "sent" && anchorAt.length > 10 ? anchorAt : (step.at ?? "");
    const m = momentShort(at, locale);
    const said = m.time ? fmt(d.tenant.stepMoment, { date: m.date, time: m.time }) : m.date;
    return step.key === "taken" && step.state === "now" ? fmt(d.tenant.stepUpdated, { date: said }) : said;
  };
  const recent = (conversation?.messages ?? []).filter((m) => m.ticketId === null && m.senderKind !== "system" && m.sentAt >= anchorAt).slice(-2);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/locataire/demandes" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 hover:underline">
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
          {request.state === "refused" && request.closedAt && <Badge>{fmt(d.tenant.reqRefusedOn, { date: formatDate(request.closedAt, locale) })}</Badge>}
          {request.kind === "technical" && severityMeta[request.severity] && <MetaBadge meta={severityMeta[request.severity]} />}
        </div>
      </div>

      {request.description && (
        <Card className="p-5">
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{request.description}</p>
        </Card>
      )}

      <Panel title={d.tenant.threadTitle}>
        {(visitAhead || request.status === "pending_tenant") && (
          <div className="mb-5 rounded-2xl border border-brand-100 bg-brand-50 px-4 py-3.5" data-next-step>
            <p className="tenant-eyebrow text-[11px] font-semibold uppercase tracking-wide text-brand-700">{d.tenant.nextStepTitle}</p>
            {visitAhead && when ? (
              <>
                <p className="mt-1 font-display text-base font-bold text-ink">
                  {visit?.artisanName ? fmt(d.tenant.nextVisit, { name: visit.artisanName, date: when.date, time: when.time }) : fmt(d.tenant.nextVisitAnon, { date: when.date, time: when.time })}
                </p>
                {live && <p className="mt-0.5 text-sm text-ink-soft">{d.tenant.nextVisitBody}</p>}
              </>
            ) : (
              <p className="mt-1 font-display text-base font-bold text-ink">{d.tenant.nextReply}</p>
            )}
          </div>
        )}
        <ol className="tenant-steps">
          {steps.map((step) => {
            const planned = step.key === "visit" && visit && when;
            return (
              <li key={step.key}>
                <span className="tenant-step-dot" data-state={step.state} aria-hidden>
                  {step.state === "done" || step.key === "resolved" && step.state === "now" ? <Icon name="check" size={14} /> : step.state === "now" ? <Icon name="clock" size={14} /> : null}
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className={"text-sm font-semibold " + (step.state === "todo" ? "text-ink-soft" : "text-ink")}>{step.key === "taken" && step.state !== "todo" && managerName ? fmt(d.tenant.stepTakenBy, { name: managerName }) : stepLabel[step.key]}</p>
                  {planned ? (
                    <p className="text-xs tabular-nums text-ink-soft">{when.time ? fmt(d.tenant.stepMoment, { date: when.date, time: when.time }) : when.date}</p>
                  ) : step.at ? (
                    <p className="text-xs tabular-nums text-ink-soft">{stepWhen(step)}</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </Panel>

      <Panel
        title={d.tenant.lastMessages}
        action={
          <Link href={`/locataire/messages?demande=${encodeURIComponent(request.id)}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 hover:underline">
            {d.tenant.reqInChat}
          </Link>
        }
      >
        {recent.length === 0 ? (
          <p className="text-sm text-ink-soft">{d.tenant.threadEmpty}</p>
        ) : (
          <ul className="space-y-3">
            {recent.map((m) => (
              <li key={m.id} className={m.mine ? "text-right" : ""}>
                <div className={"inline-block max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-left text-sm leading-relaxed " + (m.mine ? "rounded-br-md bg-brand-600 text-white" : "rounded-bl-md bg-sand-100 text-ink")}>{m.body}</div>
                <p className="mt-1 text-xs text-ink-soft">
                  {m.mine ? d.tenant.threadYou : m.senderKind === "manager" ? managerName : d.tenant.threadOther} · <span className="tabular-nums">{(() => { const at = momentShort(m.sentAt, locale); return at.time ? fmt(d.tenant.stepMoment, { date: at.date, time: at.time }) : at.date; })()}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
        {live && (
          <TenantReply
            leaseId={request.leaseId}
            labels={{ placeholder: d.tenant.replyPlaceholder, send: d.tenant.threadSend, sent: d.tenant.threadSent, failed: d.tenant.threadFailed }}
            sampleNote={sampleNote}
            before={open ? <TenantAddPhotos compact requestId={request.id} labels={{ add: d.tenant.attachPhoto, uploading: d.tenant.uploading, added: d.tenant.photoAdded, failed: d.tenant.photoFailed }} sampleNote={sampleNote} /> : undefined}
          />
        )}
      </Panel>

      <Panel title={d.tenant.photosTitle} action={open && live ? <TenantAddPhotos requestId={request.id} labels={{ add: d.tenant.addPhoto, uploading: d.tenant.uploading, added: d.tenant.photoAdded, failed: d.tenant.photoFailed }} sampleNote={sampleNote} /> : undefined}>
        {request.attachments.length === 0 ? (
          <p className="text-sm text-ink-soft">{d.tenant.photosNone}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {request.attachments.map((a) => (
              <li key={a.id} className="overflow-hidden rounded-xl border border-sand-200 bg-sand-50">
                {a.url ? (
                  <a href={a.url} target="_blank" rel="noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.url} alt={a.name} loading="lazy" decoding="async" className="aspect-square w-full object-cover" />
                  </a>
                ) : (
                  <p className="p-3 text-xs text-ink-soft">{a.name}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

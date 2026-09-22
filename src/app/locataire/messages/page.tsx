import Link from "next/link";
import TenantChat, { type TenantChatMessage, type TenantChatRequest } from "@/components/gestion/TenantChat";
import TenantEmpty from "@/components/gestion/TenantEmpty";
import { getDemo } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";
import { INTL_LOCALE, fmt } from "@/lib/i18n/config";
import { getTenantView } from "@/lib/portal/space";
import { formatDate, requestStateMeta } from "@/lib/types";

/**
 * "Messages": the tenant's conversation with their manager, one per
 * tenancy, the requests they sent sitting in it. The conversation comes
 * from the tenant's own space, so it is theirs by construction; a request
 * named in the address (`?demande=`) opens the conversation at its card.
 */
export default async function TenantMessagesPage({ searchParams }: { searchParams: Promise<{ bail?: string; demande?: string }> }) {
  const params = await searchParams;
  const { locale, d } = await getI18n();
  const view = await getTenantView();
  if (view.kind === "signed_out") return null;
  const { space, sample } = view;
  const lease = space.current ?? space.past[0];
  if (!lease) return <TenantEmpty d={d} manage={view.canManage} />;

  const byRequest = params.demande ? space.conversations.find((c) => c.messages.some((m) => m.ticketId === params.demande)) : undefined;
  const byLease = params.bail ? space.conversations.find((c) => c.leaseId === params.bail) : undefined;
  const conversation = byRequest ?? byLease ?? space.conversations.find((c) => c.leaseId === lease.id) ?? null;
  const leases = [...(space.current ? [space.current] : []), ...space.others, ...space.past];
  const chatLease = (conversation ? leases.find((l) => l.id === conversation.leaseId) : undefined) ?? (params.bail ? leases.find((l) => l.id === params.bail) : undefined) ?? lease;
  const home = `${chatLease.unit.label} · ${chatLease.property.name}`;
  const managerName = space.managers.map((m) => m.name).filter(Boolean).join(" · ") || d.tenant.managerTitle;
  const stateMeta = requestStateMeta(d);

  const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(INTL_LOCALE[locale], { hour: "2-digit", minute: "2-digit" });
  const messages: TenantChatMessage[] = (conversation?.messages ?? []).map((m) => ({
    id: m.id,
    mine: m.mine,
    kind: m.senderKind,
    from: m.mine ? d.tenant.threadYou : m.senderKind === "manager" ? managerName : m.senderKind === "system" ? "" : d.tenant.threadOther,
    body: m.body,
    dayLabel: formatDate(m.sentAt.slice(0, 10), locale),
    timeLabel: timeOf(m.sentAt),
    requestId: m.ticketId,
  }));
  const requests: Record<string, TenantChatRequest> = {};
  for (const r of space.requests) {
    requests[r.id] = {
      id: r.id,
      title: r.title,
      description: r.description || null,
      statusLabel: stateMeta[r.state].label,
      statusColor: stateMeta[r.state].color,
      attachments: r.attachments.map((a) => ({ id: a.id, name: a.name, url: a.url })),
      href: `/locataire/demandes/${r.id}`,
    };
  }
  const others = space.conversations.filter((c) => c.id !== conversation?.id);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{d.tenant.msgTitle}</h1>
        <p className="mt-1 text-sm text-ink-soft">{d.tenant.msgSub}</p>
      </div>

      {others.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.tenant.msgPick}</p>
          <div className="flex flex-wrap gap-2">
            {others.map((c) => (
              <Link key={c.id} href={`/locataire/messages?bail=${encodeURIComponent(c.leaseId)}`} className="tactile rounded-full border border-sand-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-ink-soft transition hover:border-brand-300 hover:text-brand-700">
                {c.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      <TenantChat
        leaseId={chatLease.id}
        title={managerName}
        subtitle={home}
        messages={messages}
        requests={requests}
        labels={{
          empty: d.tenant.threadEmpty,
          write: d.tenant.threadWrite,
          send: d.tenant.threadSend,
          sent: d.tenant.threadSent,
          failed: d.tenant.threadFailed,
          view: d.tenant.msgView,
          requestBadge: d.messages.requestBadge,
          newRequest: d.tenant.reqNew,
        }}
        newRequestHref={space.current && space.current.id === chatLease.id ? "/locataire/demandes?nouvelle=1" : null}
        sampleNote={sample ? fmt(d.shell.sampleBanner, { cabinet: (await getDemo()).ORG.shortName }) : null}
        focusRequestId={byRequest && params.demande ? params.demande : null}
      />
    </div>
  );
}

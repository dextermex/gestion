import type { TenantChatMessage, TenantChatRequest } from "@/components/gestion/TenantChat";
import TenantEmpty from "@/components/gestion/TenantEmpty";
import TenantMessages, { type TenantConversationView } from "@/components/gestion/TenantMessages";
import { getDemo } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { dayKey, timeOfDay, whenShort } from "@/lib/portal/format";
import { tenantPieceLabels } from "@/lib/portal/labels";
import { getTenantView } from "@/lib/portal/space";
import type { TenantMessage } from "@/lib/portal/tenant-space";
import { formatDate, requestStateMeta } from "@/lib/types";

/**
 * "Messages": the tenant's conversations with their manager, one per
 * tenancy, the requests they sent sitting in them. The conversations come
 * from the tenant's own space, so they are theirs by construction. The
 * address may name one: a request (`?demande=`) opens its conversation at
 * its card, a tenancy (`?bail=`) its conversation; otherwise the current
 * tenancy's is the one open on a laptop, and a phone shows the list. Every
 * hour is printed on Luxembourg's clock, the same line the desk reads.
 */

export default async function TenantMessagesPage({ searchParams }: { searchParams: Promise<{ bail?: string; demande?: string }> }) {
  const params = await searchParams;
  const { locale, d } = await getI18n();
  const view = await getTenantView();
  if (view.kind === "signed_out") return null;
  const { space, sample } = view;
  const lease = space.current ?? space.past[0];
  if (!lease) return <TenantEmpty d={d} manage={view.canManage} />;

  const leases = [...(space.current ? [space.current] : []), ...space.others, ...space.past];
  const homeOf = (leaseId: string): string => {
    const l = leases.find((x) => x.id === leaseId);
    return l ? `${l.unit.label} · ${l.property.name}` : "";
  };
  const managerName = space.managers.map((m) => m.name).filter(Boolean).join(" · ") || d.tenant.managerTitle;
  const stateMeta = requestStateMeta(d);

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

  const toMessages = (messages: TenantMessage[]): TenantChatMessage[] =>
    messages.map((m) => ({
      id: m.id,
      mine: m.mine,
      kind: m.senderKind,
      from: m.mine ? d.tenant.threadYou : m.senderKind === "manager" ? managerName : m.senderKind === "system" ? "" : d.tenant.threadOther,
      body: m.body,
      dayLabel: formatDate(dayKey(m.sentAt), locale),
      timeLabel: timeOfDay(m.sentAt, locale),
      requestId: m.ticketId,
    }));
  const openRequestsOf = (leaseId: string) => space.requests.filter((r) => r.leaseId === leaseId && (r.state === "sent" || r.state === "in_progress")).map((r) => ({ id: r.id, title: r.title }));
  const newRequestHrefOf = (leaseId: string) => (space.current && space.current.id === leaseId ? "/locataire/demandes?nouvelle=1" : null);

  // The list: the most recent conversation first, the last word as its preview
  // (a request by its title, badged as such).
  const conversations: TenantConversationView[] = [...space.conversations]
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
    .map((c) => {
      const last = c.messages[c.messages.length - 1];
      const request = last?.ticketId ? (requests[last.ticketId] ?? null) : null;
      return {
        id: c.id,
        leaseId: c.leaseId,
        label: c.label || homeOf(c.leaseId),
        lastLabel: last ? whenShort(last.sentAt, locale, space.today) : "",
        preview: request ? request.title : (last?.body ?? ""),
        previewIsRequest: request !== null,
        messages: toMessages(c.messages),
        lastAt: last?.sentAt ?? "",
        unread: c.unread,
        openRequests: openRequestsOf(c.leaseId),
        newRequestHref: newRequestHrefOf(c.leaseId),
      };
    });
  // A tenancy no word has been written to yet (the current one, or the one
  // the address names) is still a conversation to open: its first word
  // starts it.
  for (const leaseId of [lease.id, ...(params.bail && leases.some((l) => l.id === params.bail) ? [params.bail] : [])]) {
    if (conversations.some((c) => c.leaseId === leaseId)) continue;
    conversations.push({ id: `lease:${leaseId}`, leaseId, label: homeOf(leaseId), lastLabel: "", preview: "", previewIsRequest: false, messages: [], lastAt: "", unread: 0, openRequests: openRequestsOf(leaseId), newRequestHref: newRequestHrefOf(leaseId) });
  }

  const byRequest = params.demande ? conversations.find((c) => c.messages.some((m) => m.requestId === params.demande)) : undefined;
  const byLease = params.bail ? conversations.find((c) => c.leaseId === params.bail) : undefined;
  const initial = byRequest ?? byLease ?? conversations.find((c) => c.leaseId === lease.id) ?? conversations[0];
  const asked = Boolean(byRequest ?? byLease);

  return (
    <TenantMessages
      // A new address (a chip on a laptop) starts the screen over on what it names.
      key={`${initial.id}:${params.demande ?? ""}`}
      conversations={conversations}
      requests={requests}
      managerName={managerName}
      initialId={initial.id}
      initialView={asked ? "chat" : "list"}
      focusRequestId={byRequest && params.demande ? params.demande : null}
      title={d.tenant.msgTitle}
      subtitle={d.tenant.msgSub}
      pickLabel={d.tenant.msgPick}
      labels={{
        empty: d.tenant.threadEmpty,
        noneYet: d.tenant.msgNoneYet,
        write: d.tenant.threadWrite,
        send: d.tenant.threadSend,
        sent: d.tenant.threadSent,
        failed: d.tenant.threadFailed,
        view: d.tenant.msgView,
        requestBadge: d.messages.requestBadge,
        newRequest: d.tenant.reqNew,
        photo: d.tenant.chatPhoto,
        photoTitle: d.tenant.chatPhotoTitle,
        photoPick: d.tenant.chatPhotoPick,
        photoNone: d.tenant.chatPhotoNone,
        photoMessage: d.tenant.chatPhotoMessage,
        photoChoose: d.tenant.photoPick,
        photoFailed: d.tenant.photoFailed,
        pieces: tenantPieceLabels(d),
        uploading: d.tenant.uploading,
        close: d.common.close,
      }}
      backLabel={d.messages.backToThreads}
      sampleNote={sample ? fmt(d.shell.sampleBanner, { cabinet: (await getDemo()).ORG.shortName }) : null}
    />
  );
}

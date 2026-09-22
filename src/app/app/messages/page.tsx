import { EmptyState, PageHeader } from "@/components/pro/ui";
import { LegalNote } from "@/components/gestion/bits";
import MessagesCenter, { type MessageView, type RequestView, type Tab, type ThreadView } from "@/components/gestion/MessagesCenter";
import { getDemo, isSampleData } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";
import { INTL_LOCALE, type Locale, fmt } from "@/lib/i18n/config";
import { requestStatusOf } from "@/lib/portal/types";
import { formatDate, requestStatusMeta } from "@/lib/types";

/**
 * Messages, the desk's side: one continuous conversation per tenancy (and
 * the mandate or contact threads the workspace keeps), and the tenants'
 * requests tracked to their resolution. A request sits in its tenancy's
 * conversation as the message that carries it; its status is the ticket's;
 * its photos are the ticket's documents. The page shapes the active dataset
 * for the screen and computes nothing the screen could not read back from
 * the database.
 *
 * `?onglet=demandes` opens the tracking view, `?demande=<id>` a request
 * inside its conversation, `?fil=<id>` any conversation.
 */

function timeOf(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleTimeString(INTL_LOCALE[locale], { hour: "2-digit", minute: "2-digit" });
}

/** For the list: the time today, the day otherwise. */
function whenLabel(iso: string, locale: Locale, today: string): string {
  if (iso.length <= 10) return formatDate(iso, locale);
  return iso.slice(0, 10) === today ? timeOf(iso, locale) : new Date(iso).toLocaleDateString(INTL_LOCALE[locale], { day: "numeric", month: "short" });
}

/** The tenant's words, without the kind tag a non-technical request carries in storage. */
function plainDescription(description: string | null): string | null {
  const text = (description ?? "").replace(/^\[(document|question|other)\]\s*/, "").trim();
  return text === "" ? null : text;
}

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ onglet?: string; demande?: string; fil?: string }> }) {
  const params = await searchParams;
  const { locale, d } = await getI18n();
  const demo = await getDemo();
  const sample = await isSampleData();
  const { CONVERSATIONS, LEASES, TICKETS, TODAY, leaseTenantNames, leaseUnitLabel } = demo;
  const m = d.messages;

  const requestTickets = TICKETS.filter((t) => t.source === "tenant");
  const liveLeases = LEASES.filter((l) => l.status === "active" || l.status === "notice");
  if (CONVERSATIONS.length === 0 && requestTickets.length === 0 && liveLeases.length === 0) {
    return (
      <div>
        <EmptyState title={fmt(d.common.emptyTitle, { section: d.hubs.messages })} body={d.common.emptyBody} />
      </div>
    );
  }

  const conversationById = new Map(CONVERSATIONS.map((c) => [c.id, c]));
  const requests: RequestView[] = requestTickets.map((t) => {
    const lease = t.leaseId ? LEASES.find((l) => l.id === t.leaseId) : undefined;
    const thread = t.conversationId ? conversationById.get(t.conversationId) : undefined;
    const tenantName = (lease ? leaseTenantNames(lease).join(", ") : "") || thread?.participantName || d.common.none;
    const lastOfThread = thread?.messages[thread.messages.length - 1]?.at ?? "";
    const activityAt = lastOfThread > t.updatedAt ? lastOfThread : t.updatedAt;
    const n = t.attachments.length;
    return {
      id: t.id,
      ref: t.ref,
      title: t.title,
      description: plainDescription(t.description),
      status: requestStatusOf(t.status),
      tenantName,
      placeLabel: t.unitLabel || d.common.none,
      createdLabel: formatDate(t.createdAt, locale),
      openedLabel: fmt(m.requestOpened, { date: formatDate(t.createdAt, locale) }),
      activityAt,
      activityLabel: whenLabel(activityAt, locale, TODAY),
      threadId: thread?.id ?? null,
      interventionId: t.interventionId,
      attachments: t.attachments,
      attachmentsLabel: n === 0 ? null : n === 1 ? m.attachmentOne : fmt(m.attachmentsCount, { n }),
    };
  });
  const requestById = new Map(requests.map((r) => [r.id, r]));

  const toMessage = (msg: (typeof CONVERSATIONS)[number]["messages"][number]): MessageView => ({
    id: msg.id,
    from: msg.from,
    kind: msg.kind,
    body: msg.body,
    dayLabel: formatDate(msg.at.slice(0, 10), locale),
    timeLabel: timeOf(msg.at, locale),
    requestId: msg.ticketId && requestById.has(msg.ticketId) ? msg.ticketId : null,
  });
  const threads: ThreadView[] = CONVERSATIONS.map((c): ThreadView => {
    const messages = c.messages.map(toMessage);
    const last = messages[messages.length - 1];
    const lastRequest = last?.requestId ? requestById.get(last.requestId) : undefined;
    return {
      id: c.id,
      leaseId: c.scopeType === "lease" ? c.scopeId : null,
      subject: c.subject,
      scopeLabel: c.scopeLabel,
      participantName: c.participantName,
      isTenancy: c.scopeType === "lease",
      lastMessageAt: c.lastMessageAt,
      lastLabel: whenLabel(c.lastMessageAt, locale, TODAY),
      unread: c.unread,
      preview: lastRequest ? lastRequest.title : (last?.body ?? ""),
      previewIsRequest: Boolean(lastRequest),
      messages,
    };
  }).sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
  // A tenancy nobody has written to yet is still a conversation to open:
  // the desk's first word creates it.
  const withConversation = new Set(threads.filter((t) => t.leaseId).map((t) => t.leaseId));
  const unopened: ThreadView[] = liveLeases
    .filter((l) => !withConversation.has(l.id))
    .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))
    .map((l) => ({
      id: `lease:${l.id}`,
      leaseId: l.id,
      subject: leaseUnitLabel(l),
      scopeLabel: leaseUnitLabel(l),
      participantName: leaseTenantNames(l).join(", ") || d.common.none,
      isTenancy: true,
      lastMessageAt: l.startDate,
      lastLabel: "",
      unread: 0,
      preview: "",
      previewIsRequest: false,
      messages: [],
    }));
  threads.push(...unopened);

  const askedRequest = params.demande ? (requestById.get(params.demande) ?? null) : null;
  const wanted = askedRequest ? askedRequest.threadId : params.fil;
  const initialThreadId = wanted && threads.some((t) => t.id === wanted) ? wanted : (threads[0]?.id ?? null);
  const initialTab: Tab = params.onglet === "demandes" && !askedRequest ? "requests" : "conversations";

  return (
    <div>
      <PageHeader title={m.title} subtitle={m.subtitle} />

      <MessagesCenter
        threads={threads}
        requests={requests}
        statusMeta={requestStatusMeta(d)}
        initialTab={initialTab}
        initialThreadId={initialThreadId}
        initialRequestId={askedRequest && askedRequest.threadId === initialThreadId ? askedRequest.id : null}
        writable={!sample}
        sampleNote={sample ? fmt(d.shell.sampleBanner, { cabinet: demo.ORG.shortName }) : null}
        labels={{
          tabConversations: m.tabConversations,
          tabRequests: m.tabRequests,
          requestBadge: m.requestBadge,
          emptyThreads: m.emptyThreads,
          emptyRequests: m.emptyRequests,
          requestsHint: m.requestsHint,
          detailsTitle: m.detailsTitle,
          refuse: m.refuse,
          fieldTenant: m.fieldTenant,
          fieldProperty: m.fieldProperty,
          fieldCreated: m.fieldCreated,
          fieldActivity: m.fieldActivity,
          fieldStatus: m.fieldStatus,
          attachmentsTitle: m.attachmentsTitle,
          createIntervention: m.createIntervention,
          interventionCreated: m.interventionCreated,
          interventionOpen: m.interventionOpen,
          you: m.you,
          replyPlaceholder: m.replyPlaceholder,
          send: d.common.send,
          sent: m.replySent,
          sendFailed: m.sendFailed,
          statusFailed: m.statusFailed,
          interventionFailed: m.interventionFailed,
          unreadAria: m.unreadAria,
          colSubject: m.colSubject,
          colTenant: m.colTenant,
          colProperty: m.colProperty,
          colDate: m.colDate,
          colActivity: m.colActivity,
          colStatus: m.colStatus,
          openThread: m.openThread,
          noThreadYet: m.noThreadYet,
          viewRequest: m.viewRequest,
          close: d.common.close,
        }}
      />

      <LegalNote>{m.legal}</LegalNote>
    </div>
  );
}

import { EmptyState, PageHeader } from "@/components/pro/ui";
import { LegalNote } from "@/components/gestion/bits";
import MessagesCenter, { type MessageView, type RequestView, type Tab, type ThreadView } from "@/components/gestion/MessagesCenter";
import { getDemo, isSampleData } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";
import { INTL_LOCALE, type Locale, fmt } from "@/lib/i18n/config";
import { pendingThreadId, requestStatusOf } from "@/lib/portal/types";
import { formatDate, requestStatusMeta } from "@/lib/types";

/**
 * Messages, the desk's side. Two views of one set of rows: every thread of
 * the workspace, and the tenants' requests tracked to their resolution.
 * A request's thread is the ticket-scoped conversation the tenant's space
 * shows; its status is the ticket's; its photos are the ticket's
 * documents. The page shapes the active dataset for the screen and
 * computes nothing the screen could not read back from the database.
 *
 * `?onglet=demandes` opens the tracking view, `?demande=<id>` a request's
 * thread, `?fil=<id>` any conversation.
 */

function timeOf(iso: string, locale: Locale): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(INTL_LOCALE[locale], { day: "numeric", month: "short" }) +
    " · " +
    d.toLocaleTimeString(INTL_LOCALE[locale], { hour: "2-digit", minute: "2-digit" })
  );
}

/** A day prints as a date, an instant as date and time. */
function whenLabel(iso: string, locale: Locale): string {
  return iso.length <= 10 ? formatDate(iso, locale) : timeOf(iso, locale);
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
  const { CONVERSATIONS, LEASES, TICKETS, leaseTenantNames } = demo;

  const requestTickets = TICKETS.filter((t) => t.source === "tenant");
  if (CONVERSATIONS.length === 0 && requestTickets.length === 0) {
    return (
      <div>
        <EmptyState title={fmt(d.common.emptyTitle, { section: d.hubs.messages })} body={d.common.emptyBody} />
      </div>
    );
  }

  const threadByConversation = new Map(CONVERSATIONS.map((c) => [c.id, c]));
  const requests: RequestView[] = requestTickets.map((t) => {
    const lease = t.leaseId ? LEASES.find((l) => l.id === t.leaseId) : undefined;
    const thread = t.conversationId ? threadByConversation.get(t.conversationId) : undefined;
    const tenantName = (lease ? leaseTenantNames(lease).join(", ") : "") || thread?.participantName || d.common.none;
    const activityAt = thread && thread.lastMessageAt > t.updatedAt ? thread.lastMessageAt : t.updatedAt;
    return {
      id: t.id,
      ref: t.ref,
      title: t.title,
      description: plainDescription(t.description),
      status: requestStatusOf(t.status),
      tenantName,
      placeLabel: t.unitLabel || d.common.none,
      createdLabel: formatDate(t.createdAt, locale),
      openedLabel: fmt(d.messages.requestOpened, { date: formatDate(t.createdAt, locale) }),
      activityAt,
      activityLabel: whenLabel(activityAt, locale),
      threadId: t.conversationId ?? pendingThreadId(t.id),
      interventionId: t.interventionId,
      attachments: t.attachments,
    };
  });
  const requestByThread = new Map(requests.map((r) => [r.threadId, r]));

  const toMessage = (m: (typeof CONVERSATIONS)[number]["messages"][number]): MessageView => ({
    id: m.id,
    from: m.from,
    kind: m.kind,
    body: m.body,
    timeLabel: timeOf(m.at, locale),
  });
  const threads: ThreadView[] = [
    ...CONVERSATIONS.map((c): ThreadView => {
      const request = requestByThread.get(c.id) ?? null;
      const last = c.messages[c.messages.length - 1];
      return {
        id: c.id,
        subject: c.subject,
        scopeLabel: c.scopeLabel,
        participantName: request?.tenantName ?? c.participantName,
        lastMessageAt: c.lastMessageAt,
        lastLabel: whenLabel(c.lastMessageAt, locale),
        unread: c.unread,
        preview: last?.body ?? request?.description ?? request?.title ?? "",
        requestId: request?.id ?? null,
        messages: c.messages.map(toMessage),
      };
    }),
    // A request nobody has written on yet still has a place in the list:
    // the first reply opens its conversation.
    ...requests
      .filter((r) => !threadByConversation.has(r.threadId))
      .map(
        (r): ThreadView => ({
          id: r.threadId,
          subject: r.title,
          scopeLabel: [r.ref, r.placeLabel].filter((x) => x && x !== d.common.none).join(" · "),
          participantName: r.tenantName,
          lastMessageAt: r.activityAt,
          lastLabel: r.activityLabel,
          unread: 0,
          preview: r.description ?? r.title,
          requestId: r.id,
          messages: [],
        }),
      ),
  ].sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));

  const wanted = params.demande ? requests.find((r) => r.id === params.demande)?.threadId : params.fil;
  const initialThreadId = wanted && threads.some((t) => t.id === wanted) ? wanted : (threads[0]?.id ?? null);
  const initialTab: Tab = params.onglet === "demandes" && !params.demande ? "requests" : "conversations";
  const m = d.messages;

  return (
    <div>
      <PageHeader title={m.title} subtitle={m.subtitle} />

      <MessagesCenter
        threads={threads}
        requests={requests}
        statusMeta={requestStatusMeta(d)}
        initialTab={initialTab}
        initialThreadId={initialThreadId}
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
        }}
      />

      <LegalNote>{m.legal}</LegalNote>
    </div>
  );
}

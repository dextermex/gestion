"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card, Select, Textarea } from "@/components/pro/ui";
import { isPendingThreadId, isRequestOpen, REQUEST_STATUSES, type RequestStatus } from "@/lib/portal/types";
import { initials, type Meta } from "@/lib/types";

/**
 * The desk's Messages: every thread of the workspace on one screen, and
 * the tenants' requests tracked among them. A request is a thread with a
 * status: the row the tenant raised, the conversation both sides write
 * on, read here from the same tables the tenant's space reads. Nothing on
 * this screen is a copy; every write goes through the API under the
 * manager's own session and the page then reads the rows back.
 */

export interface MessageView {
  id: string;
  from: string;
  kind: "tenant" | "manager" | "owner" | "artisan" | "system";
  body: string;
  timeLabel: string;
}

export interface AttachmentView {
  id: string;
  name: string;
  url: string | null;
}

export interface RequestView {
  id: string;
  ref: string;
  title: string;
  description: string | null;
  status: RequestStatus;
  tenantName: string;
  placeLabel: string;
  createdLabel: string;
  /** "Demande envoyée le {date}", ready to print. */
  openedLabel: string;
  activityAt: string;
  activityLabel: string;
  /** The thread's id: the conversation's, or a stand-in until the first message opens one. */
  threadId: string;
  interventionId: string | null;
  attachments: AttachmentView[];
}

export interface ThreadView {
  id: string;
  subject: string;
  scopeLabel: string;
  participantName: string;
  lastMessageAt: string;
  lastLabel: string;
  unread: number;
  preview: string;
  /** Set when the thread is a tenant request's. */
  requestId: string | null;
  messages: MessageView[];
}

export interface MessagesLabels {
  tabConversations: string;
  tabRequests: string;
  requestBadge: string;
  emptyThreads: string;
  emptyRequests: string;
  requestsHint: string;
  detailsTitle: string;
  refuse: string;
  fieldTenant: string;
  fieldProperty: string;
  fieldCreated: string;
  fieldActivity: string;
  fieldStatus: string;
  attachmentsTitle: string;
  createIntervention: string;
  interventionCreated: string;
  interventionOpen: string;
  you: string;
  replyPlaceholder: string;
  send: string;
  sent: string;
  sendFailed: string;
  statusFailed: string;
  interventionFailed: string;
  unreadAria: string;
  colSubject: string;
  colTenant: string;
  colProperty: string;
  colDate: string;
  colActivity: string;
  colStatus: string;
  openThread: string;
  noThreadYet: string;
}

export type Tab = "conversations" | "requests";

type Notice = { tone: "ok" | "error" | "sample"; text: string } | null;
type Busy = "send" | "status" | "intervention" | null;

const SENDER_COLORS: Record<MessageView["kind"], string> = {
  tenant: "bg-sky-100 text-sky-800",
  manager: "bg-brand-100 text-brand-800",
  owner: "bg-violet-100 text-violet-800",
  artisan: "bg-amber-100 text-amber-800",
  system: "bg-sand-100 text-ink-soft",
};

export default function MessagesCenter({
  threads,
  requests,
  statusMeta,
  labels,
  initialTab,
  initialThreadId,
  writable,
  sampleNote,
}: {
  threads: ThreadView[];
  requests: RequestView[];
  statusMeta: Record<RequestStatus, Meta>;
  labels: MessagesLabels;
  initialTab: Tab;
  initialThreadId: string | null;
  /** False on a sample cabinet: the screen works, nothing is written. */
  writable: boolean;
  sampleNote: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [activeId, setActiveId] = useState<string | null>(initialThreadId);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const [statusOverrides, setStatusOverrides] = useState<Record<string, RequestStatus>>({});
  const [interventionOverrides, setInterventionOverrides] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const requestById = new Map(requests.map((r) => [r.id, r]));
  const statusOf = (r: RequestView): RequestStatus => statusOverrides[r.id] ?? r.status;
  const interventionOf = (r: RequestView): string | null => interventionOverrides[r.id] ?? r.interventionId;
  const unreadOf = (t: ThreadView): number => (readIds.has(t.id) ? 0 : t.unread);

  const active = threads.find((t) => t.id === activeId) ?? threads[0] ?? null;
  const activeRequest = active?.requestId ? (requestById.get(active.requestId) ?? null) : null;
  const openCount = requests.filter((r) => isRequestOpen(statusOf(r))).length;

  const rememberInUrl = (thread: ThreadView) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("fil");
    url.searchParams.delete("demande");
    url.searchParams.delete("onglet");
    if (thread.requestId) url.searchParams.set("demande", thread.requestId);
    else url.searchParams.set("fil", thread.id);
    window.history.replaceState(window.history.state, "", url);
  };

  const signInAgain = () => {
    window.location.assign(`/connexion?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  };

  const sampleOnly = (): boolean => {
    if (writable) return false;
    setNotice({ tone: "sample", text: sampleNote ?? "" });
    return true;
  };

  /** Opening a thread: it becomes the one on screen, and what the other side wrote is read. */
  const openThread = (thread: ThreadView) => {
    setActiveId(thread.id);
    setTab("conversations");
    setNotice(null);
    rememberInUrl(thread);
    if (thread.unread === 0 || readIds.has(thread.id)) return;
    setReadIds((ids) => new Set(ids).add(thread.id));
    if (!writable || isPendingThreadId(thread.id)) return;
    fetch(`/api/conversations/${thread.id}/lu`, { method: "POST" })
      .then((res) => {
        if (res.ok) router.refresh();
      })
      .catch(() => null);
  };

  const showTab = (next: Tab) => {
    setTab(next);
    setNotice(null);
    const url = new URL(window.location.href);
    if (next === "requests") url.searchParams.set("onglet", "demandes");
    else url.searchParams.delete("onglet");
    window.history.replaceState(window.history.state, "", url);
  };

  const send = async (thread: ThreadView) => {
    const body = (drafts[thread.id] ?? "").trim();
    if (body === "" || busy) return;
    if (sampleOnly()) return;
    setBusy("send");
    setNotice(null);
    try {
      const target = thread.requestId ? `/api/demandes/${thread.requestId}/messages` : `/api/conversations/${thread.id}/messages`;
      const res = await fetch(target, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
      if (res.status === 401) return signInAgain();
      const data = (await res.json().catch(() => ({}))) as { conversationId?: string };
      if (!res.ok) {
        setNotice({ tone: "error", text: labels.sendFailed });
        return;
      }
      setDrafts((all) => ({ ...all, [thread.id]: "" }));
      // A first reply on a request opens its thread: follow it to the real one.
      if (data.conversationId && data.conversationId !== thread.id) setActiveId(data.conversationId);
      setNotice({ tone: "ok", text: labels.sent });
      router.refresh();
    } catch {
      setNotice({ tone: "error", text: labels.sendFailed });
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (request: RequestView, status: RequestStatus) => {
    const before = statusOf(request);
    if (status === before || busy) return;
    setStatusOverrides((all) => ({ ...all, [request.id]: status }));
    if (sampleOnly()) return;
    setBusy("status");
    setNotice(null);
    try {
      const res = await fetch(`/api/demandes/${request.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      if (res.status === 401) return signInAgain();
      if (!res.ok) {
        setStatusOverrides((all) => ({ ...all, [request.id]: before }));
        setNotice({ tone: "error", text: labels.statusFailed });
        return;
      }
      router.refresh();
    } catch {
      setStatusOverrides((all) => ({ ...all, [request.id]: before }));
      setNotice({ tone: "error", text: labels.statusFailed });
    } finally {
      setBusy(null);
    }
  };

  const createIntervention = async (request: RequestView) => {
    if (busy || sampleOnly()) return;
    setBusy("intervention");
    setNotice(null);
    try {
      const res = await fetch(`/api/demandes/${request.id}/intervention`, { method: "POST" });
      if (res.status === 401) return signInAgain();
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      if (!res.ok || !data.id) {
        setNotice({ tone: "error", text: labels.interventionFailed });
        return;
      }
      setInterventionOverrides((all) => ({ ...all, [request.id]: data.id as string }));
      setNotice({ tone: "ok", text: labels.interventionCreated });
      router.refresh();
    } catch {
      setNotice({ tone: "error", text: labels.interventionFailed });
    } finally {
      setBusy(null);
    }
  };

  const tabClass = (selected: boolean) =>
    "tactile rounded-full px-4 py-1.5 text-sm font-semibold transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 " +
    (selected ? "bg-ink text-white" : "text-ink-soft hover:bg-sand-100 hover:text-ink");

  return (
    <div>
      <div role="tablist" aria-label={labels.tabConversations} className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" role="tab" id="messages-tab-conversations" aria-selected={tab === "conversations"} aria-controls="messages-panel-conversations" onClick={() => showTab("conversations")} className={tabClass(tab === "conversations")}>
          {labels.tabConversations}
        </button>
        <button type="button" role="tab" id="messages-tab-requests" aria-selected={tab === "requests"} aria-controls="messages-panel-requests" onClick={() => showTab("requests")} className={tabClass(tab === "requests")}>
          {labels.tabRequests}
          {openCount > 0 && (
            <span className={"ml-1.5 rounded-full px-1.5 text-[11px] tabular-nums " + (tab === "requests" ? "bg-white/20" : "bg-amber-100 text-amber-800")}>{openCount}</span>
          )}
        </button>
      </div>

      {tab === "requests" ? (
        <div role="tabpanel" id="messages-panel-requests" aria-labelledby="messages-tab-requests">
          <RequestsTable requests={requests} statusOf={statusOf} statusMeta={statusMeta} labels={labels} onOpen={(r) => openThread(threads.find((t) => t.id === r.threadId) ?? threads[0])} />
        </div>
      ) : (
        <div role="tabpanel" id="messages-panel-conversations" aria-labelledby="messages-tab-conversations" className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
          <Card className="overflow-hidden lg:col-span-4">
            {threads.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-ink-soft">{labels.emptyThreads}</p>
            ) : (
              <ul className="divide-y divide-sand-100">
                {threads.map((thread) => (
                  <ThreadRow key={thread.id} thread={thread} unread={unreadOf(thread)} selected={active?.id === thread.id} labels={labels} onOpen={openThread} />
                ))}
              </ul>
            )}
          </Card>

          {active && (
            <Card className={"flex min-h-[28rem] flex-col " + (activeRequest ? "lg:col-span-5" : "lg:col-span-8")}>
              <div className="border-b border-sand-100 px-5 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-display text-base font-bold text-ink">{active.subject}</h2>
                  {activeRequest && <Badge className={statusMeta[statusOf(activeRequest)].color}>{statusMeta[statusOf(activeRequest)].label}</Badge>}
                </div>
                <p className="text-xs text-ink-soft">
                  {active.participantName}
                  {active.scopeLabel && ` · ${active.scopeLabel}`}
                </p>
              </div>
              <div className="flex-1 space-y-4 px-5 py-4">
                {activeRequest && <OpeningBubble request={activeRequest} />}
                {active.messages.length === 0 && activeRequest && <p className="text-xs text-ink-soft">{labels.noThreadYet}</p>}
                {active.messages.map((m) => (
                  <MessageBubble key={m.id} message={m} you={labels.you} />
                ))}
              </div>
              <form
                className="border-t border-sand-100 p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(active);
                }}
              >
                <Textarea
                  id="messages-reply"
                  aria-label={labels.replyPlaceholder}
                  placeholder={labels.replyPlaceholder}
                  rows={2}
                  maxLength={4000}
                  className="min-h-0"
                  value={drafts[active.id] ?? ""}
                  onChange={(e) => setDrafts((all) => ({ ...all, [active.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void send(active);
                    }
                  }}
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <NoticeLine notice={notice} />
                  <Button type="submit" size="sm" loading={busy === "send"} disabled={(drafts[active.id] ?? "").trim() === ""}>
                    {labels.send}
                  </Button>
                </div>
              </form>
            </Card>
          )}

          {active && activeRequest && (
            <RequestDetails
              request={activeRequest}
              status={statusOf(activeRequest)}
              interventionId={interventionOf(activeRequest)}
              statusMeta={statusMeta}
              labels={labels}
              busy={busy}
              onStatus={(status) => void setStatus(activeRequest, status)}
              onIntervention={() => void createIntervention(activeRequest)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function NoticeLine({ notice }: { notice: Notice }) {
  return (
    <p
      role="status"
      className={
        "min-h-4 text-xs font-semibold " +
        (notice?.tone === "error" ? "text-red-700" : notice?.tone === "sample" ? "rounded-lg bg-amber-50 px-2 py-1 text-amber-900" : "text-emerald-800")
      }
    >
      {notice?.text ?? ""}
    </p>
  );
}

function ThreadRow({
  thread,
  unread,
  selected,
  labels,
  onOpen,
}: {
  thread: ThreadView;
  unread: number;
  selected: boolean;
  labels: MessagesLabels;
  onOpen: (thread: ThreadView) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(thread)}
        aria-current={selected ? "true" : undefined}
        className={
          "flex w-full items-start gap-3 border-l-2 px-4 py-3 text-left transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-sand-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 " +
          (selected ? "border-brand-600 bg-brand-50/60" : "border-transparent")
        }
      >
        <span className={"mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold " + (thread.requestId ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800")}>
          {initials(thread.participantName) || "·"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className={"min-w-0 truncate text-sm text-ink " + (unread > 0 ? "font-bold" : "font-semibold")}>{thread.participantName}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-ink-soft">{thread.lastLabel}</span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            {thread.requestId && <Badge className="bg-amber-100 text-amber-800">{labels.requestBadge}</Badge>}
            <span className="min-w-0 truncate text-xs font-semibold text-ink">{thread.subject}</span>
          </span>
          <span className="mt-0.5 flex items-center gap-2">
            <span className={"min-w-0 flex-1 truncate text-xs " + (unread > 0 ? "text-ink" : "text-ink-soft")}>{thread.preview}</span>
            {unread > 0 && (
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent-600" role="img" aria-label={labels.unreadAria.replace("{n}", String(unread))} />
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

function OpeningBubble({ request }: { request: RequestView }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-800" title={request.tenantName}>
        {initials(request.tenantName) || "·"}
      </span>
      <div className="max-w-[80%]">
        <div className="rounded-2xl rounded-tl-md bg-sand-100 px-3.5 py-2.5 text-sm leading-relaxed text-ink">
          <p className="font-semibold">{request.title}</p>
          {request.description && <p className="mt-1 whitespace-pre-line">{request.description}</p>}
          {request.attachments.length > 0 && <AttachmentGrid attachments={request.attachments} compact />}
        </div>
        <p className="mt-1 text-[11px] text-ink-soft">
          {request.tenantName} · {request.openedLabel}
        </p>
      </div>
    </div>
  );
}

function MessageBubble({ message, you }: { message: MessageView; you: string }) {
  const mine = message.kind === "manager";
  return (
    <div className={"flex gap-3 " + (mine ? "flex-row-reverse" : "")}>
      <span className={"flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold " + SENDER_COLORS[message.kind]} title={message.from}>
        {initials(message.from) || "·"}
      </span>
      <div className={"max-w-[80%] " + (mine ? "text-right" : "")}>
        <div
          className={
            "inline-block whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-left text-sm leading-relaxed " +
            (mine ? "rounded-tr-md bg-brand-600 text-white" : message.kind === "system" ? "rounded-tl-md border border-dashed border-sand-200 bg-sand-50 text-ink-soft" : "rounded-tl-md bg-sand-100 text-ink")
          }
        >
          {message.body}
        </div>
        <p className="mt-1 text-[11px] text-ink-soft">
          {mine ? you : message.from} · {message.timeLabel}
        </p>
      </div>
    </div>
  );
}

function AttachmentGrid({ attachments, compact }: { attachments: AttachmentView[]; compact?: boolean }) {
  return (
    <ul className={"grid grid-cols-3 gap-2 " + (compact ? "mt-2" : "")}>
      {attachments.map((a) => (
        <li key={a.id} className="overflow-hidden rounded-xl border border-sand-200 bg-white">
          {a.url ? (
            <a href={a.url} target="_blank" rel="noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.url} alt={a.name} className="aspect-square w-full object-cover" />
            </a>
          ) : (
            <p className="truncate p-2 text-[11px] text-ink-soft" title={a.name}>
              {a.name}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function RequestDetails({
  request,
  status,
  interventionId,
  statusMeta,
  labels,
  busy,
  onStatus,
  onIntervention,
}: {
  request: RequestView;
  status: RequestStatus;
  interventionId: string | null;
  statusMeta: Record<RequestStatus, Meta>;
  labels: MessagesLabels;
  busy: Busy;
  onStatus: (status: RequestStatus) => void;
  onIntervention: () => void;
}) {
  const rows: Array<[string, string]> = [
    [labels.fieldTenant, request.tenantName],
    [labels.fieldProperty, request.placeLabel],
    [labels.fieldCreated, request.createdLabel],
    [labels.fieldActivity, request.activityLabel],
  ];
  return (
    <Card className="p-5 lg:col-span-3">
      <h2 className="font-display text-base font-bold text-ink">{labels.detailsTitle}</h2>
      <p className="text-xs tabular-nums text-ink-soft">{request.ref}</p>

      <label className="mt-4 block">
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-soft">{labels.fieldStatus}</span>
        <Select id="request-status" value={status} disabled={busy === "status"} onChange={(e) => onStatus(e.target.value as RequestStatus)}>
          {REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusMeta[s].label}
            </option>
          ))}
        </Select>
      </label>
      {isRequestOpen(status) && (
        <Button type="button" variant="ghost" size="sm" className="mt-2 text-red-700 hover:bg-red-50 hover:text-red-800" disabled={busy === "status"} onClick={() => onStatus("refused")}>
          {labels.refuse}
        </Button>
      )}

      <dl className="mt-4 space-y-2.5 border-t border-sand-100 pt-4 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-xs text-ink-soft">{label}</dt>
            <dd className="min-w-0 truncate text-right font-semibold text-ink" title={value}>
              {value}
            </dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-xs text-ink-soft">{labels.fieldStatus}</dt>
          <dd>
            <Badge className={statusMeta[status].color}>{statusMeta[status].label}</Badge>
          </dd>
        </div>
      </dl>

      {request.attachments.length > 0 && (
        <div className="mt-4 border-t border-sand-100 pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">{labels.attachmentsTitle}</p>
          <AttachmentGrid attachments={request.attachments} />
        </div>
      )}

      <div className="mt-4 border-t border-sand-100 pt-4">
        {interventionId ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge className="bg-emerald-100 text-emerald-800">{labels.interventionCreated}</Badge>
            <Link href="/app/interventions" className="text-sm font-semibold text-brand-700 hover:underline">
              {labels.interventionOpen}
            </Link>
          </div>
        ) : (
          <Button type="button" variant="secondary" className="w-full" loading={busy === "intervention"} onClick={onIntervention}>
            {labels.createIntervention}
          </Button>
        )}
      </div>
    </Card>
  );
}

function RequestsTable({
  requests,
  statusOf,
  statusMeta,
  labels,
  onOpen,
}: {
  requests: RequestView[];
  statusOf: (r: RequestView) => RequestStatus;
  statusMeta: Record<RequestStatus, Meta>;
  labels: MessagesLabels;
  onOpen: (r: RequestView) => void;
}) {
  if (requests.length === 0) {
    return (
      <Card className="px-6 py-12 text-center">
        <p className="font-display text-base font-bold text-ink">{labels.emptyRequests}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-ink-soft">{labels.requestsHint}</p>
      </Card>
    );
  }
  // What needs the desk first: open requests, most recently active on top.
  const rows = [...requests].sort((a, b) => {
    const openA = isRequestOpen(statusOf(a)) ? 0 : 1;
    const openB = isRequestOpen(statusOf(b)) ? 0 : 1;
    if (openA !== openB) return openA - openB;
    return a.activityAt < b.activityAt ? 1 : -1;
  });
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft">
              <th className="px-4 py-2.5 font-semibold">{labels.colSubject}</th>
              <th className="px-3 py-2.5 font-semibold">{labels.colTenant}</th>
              <th className="px-3 py-2.5 font-semibold">{labels.colProperty}</th>
              <th className="px-3 py-2.5 font-semibold">{labels.colDate}</th>
              <th className="px-3 py-2.5 font-semibold">{labels.colActivity}</th>
              <th className="px-4 py-2.5 text-right font-semibold">{labels.colStatus}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const status = statusOf(r);
              return (
                <tr key={r.id} className="cursor-pointer border-b border-sand-50 last:border-0 hover:bg-sand-50/50" onClick={() => onOpen(r)}>
                  <td className="px-4 py-3">
                    <button type="button" className="text-left font-semibold text-ink hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600" onClick={(e) => {
                        e.stopPropagation();
                        onOpen(r);
                      }}
                      aria-label={`${labels.openThread} : ${r.title}`}
                    >
                      {r.title}
                    </button>
                    <p className="text-xs tabular-nums text-ink-soft">{r.ref}</p>
                  </td>
                  <td className="px-3 py-3 text-ink">{r.tenantName}</td>
                  <td className="px-3 py-3 text-xs text-ink-soft">{r.placeLabel}</td>
                  <td className="px-3 py-3 text-xs tabular-nums text-ink-soft">{r.createdLabel}</td>
                  <td className="px-3 py-3 text-xs tabular-nums text-ink-soft">{r.activityLabel}</td>
                  <td className="px-4 py-3 text-right">
                    <Badge className={statusMeta[status].color}>{statusMeta[status].label}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

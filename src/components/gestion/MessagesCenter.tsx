"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LegalNote } from "@/components/gestion/bits";
import { Badge, Button, Card, Modal, PageHeader, Select, Textarea } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import { isRequestOpen, REQUEST_STATUSES, type RequestStatus } from "@/lib/portal/types";
import { initials, type Meta } from "@/lib/types";

/**
 * The desk's Messages: one continuous conversation per tenancy, the way a
 * chat reads, with the tenant's requests taking their place in it as
 * cards. The conversation, its messages and the requests are the rows the
 * tenant's space reads; nothing on this screen is a copy. Every write goes
 * through the API under the manager's own session and the page then reads
 * the rows back.
 *
 * A laptop shows the list and the open conversation side by side. A phone
 * shows one at a time, the way a messaging app does: the list first, most
 * recent on top, then a conversation filling the screen once tapped, with
 * a way back to the list where it was left. Same rows, same component: the
 * only difference is which pane the stylesheet shows below the `lg`
 * breakpoint.
 */

export interface MessageView {
  id: string;
  from: string;
  kind: "tenant" | "manager" | "owner" | "artisan" | "system";
  body: string;
  dayLabel: string;
  timeLabel: string;
  /** Set when the message is a request's place in the conversation: the card reads the request. */
  requestId: string | null;
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
  /** The conversation the request sits in, when it has one. */
  threadId: string | null;
  interventionId: string | null;
  attachments: AttachmentView[];
  attachmentsLabel: string | null;
}

export interface ThreadView {
  /** The conversation's id, or `lease:<id>` for a tenancy nobody has written to yet. */
  id: string;
  leaseId: string | null;
  subject: string;
  scopeLabel: string;
  participantName: string;
  /** A tenancy's conversation (the chat with a tenant), as opposed to a mandate's or a contact's. */
  isTenancy: boolean;
  lastMessageAt: string;
  lastLabel: string;
  unread: number;
  preview: string;
  previewIsRequest: boolean;
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
  viewRequest: string;
  close: string;
  backToThreads: string;
  backToRequests: string;
}

export type Tab = "conversations" | "requests";
/** What a phone shows: the list, or one conversation filling the screen. A laptop shows both. */
export type PhoneView = "list" | "chat";

type Notice = { tone: "ok" | "error" | "sample"; text: string } | null;
type Busy = "send" | "status" | "intervention" | null;

const SENDER_COLORS: Record<MessageView["kind"], string> = {
  tenant: "bg-sky-100 text-sky-800",
  manager: "bg-brand-100 text-brand-800",
  owner: "bg-violet-100 text-violet-800",
  artisan: "bg-amber-100 text-amber-800",
  system: "bg-sand-100 text-ink-soft",
};

/** Below Tailwind's `lg` (64rem): where the list and the conversation take turns on the screen. */
const PHONE_QUERY = "(max-width: 1023.98px)";
const onPhone = (): boolean => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE_QUERY).matches;

/**
 * The conversation filling a phone's screen under the shell's bar (3.5rem):
 * edge to edge over the page's padding, the messages scrolling inside it
 * while the header and the composer stay put.
 */
const PHONE_CHAT = "max-lg:-mx-4 max-lg:-my-6 max-lg:h-[calc(100dvh-3.5rem)] max-lg:rounded-none max-lg:border-x-0 max-lg:border-t-0 max-lg:shadow-none sm:max-lg:-mx-6";

export default function MessagesCenter({
  threads,
  requests,
  statusMeta,
  labels,
  title,
  subtitle,
  legal,
  initialTab,
  initialView,
  initialThreadId,
  initialRequestId,
  writable,
  sampleNote,
}: {
  threads: ThreadView[];
  requests: RequestView[];
  statusMeta: Record<RequestStatus, Meta>;
  labels: MessagesLabels;
  title: string;
  subtitle: string;
  legal: string;
  initialTab: Tab;
  /** On a phone: the list, unless the address named a conversation or a request. */
  initialView: PhoneView;
  initialThreadId: string | null;
  /** A request to land on inside its conversation. */
  initialRequestId: string | null;
  /** False on a sample cabinet: the screen works, nothing is written. */
  writable: boolean;
  sampleNote: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [view, setView] = useState<PhoneView>(initialView);
  /** The list the open conversation was reached from: where a phone's way back leads. */
  const [origin, setOrigin] = useState<Tab>(initialTab);
  const [activeId, setActiveId] = useState<string | null>(initialThreadId);
  const [focusRequestId, setFocusRequestId] = useState<string | null>(initialRequestId);
  const [openRequestId, setOpenRequestId] = useState<string | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const [statusOverrides, setStatusOverrides] = useState<Record<string, RequestStatus>>({});
  const [interventionOverrides, setInterventionOverrides] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** Where a phone's list was scrolled to when a conversation took the screen, and whether to go back there. */
  const listScroll = useRef(0);
  const restoreScroll = useRef<number | null>(null);

  const requestById = new Map(requests.map((r) => [r.id, r]));
  const statusOf = (r: RequestView): RequestStatus => statusOverrides[r.id] ?? r.status;
  const interventionOf = (r: RequestView): string | null => interventionOverrides[r.id] ?? r.interventionId;
  const unreadOf = (t: ThreadView): number => (readIds.has(t.id) ? 0 : t.unread);

  const active = threads.find((t) => t.id === activeId) ?? threads[0] ?? null;
  const openRequest = openRequestId ? (requestById.get(openRequestId) ?? null) : null;
  const openCount = requests.filter((r) => isRequestOpen(statusOf(r))).length;
  const messageCount = active?.messages.length ?? 0;
  // On a phone the conversation has the screen and the rest steps aside; a
  // laptop pays no attention (the classes it drives are `max-lg:` only).
  const chatOpen = view === "chat" && tab === "conversations" && active !== null;
  const backLabel = origin === "requests" ? labels.backToRequests : labels.backToThreads;

  // The conversation opens on its latest message, or on the request that
  // was asked for. Runs on the transition only: a keystroke in the
  // composer never moves the thread. On a phone the transition includes
  // the conversation taking the screen, which is when it can be scrolled.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (focusRequestId) {
      const card = el.querySelector<HTMLElement>(`[data-request="${focusRequestId}"]`);
      if (card) {
        el.scrollTop = Math.max(0, card.offsetTop - 16);
        return;
      }
    }
    el.scrollTop = el.scrollHeight;
  }, [active?.id, focusRequestId, messageCount, view]);

  // A phone's list comes back where it was left, once it is on the screen again.
  useEffect(() => {
    if (view !== "list" || restoreScroll.current === null) return;
    window.scrollTo(0, restoreScroll.current);
    restoreScroll.current = null;
  }, [view]);

  // A conversation filling a phone's screen leaves no room for the shell's
  // floating getting-started card: the document says so while it is open,
  // and the card steps aside (its own stylesheet reads the attribute).
  useEffect(() => {
    if (!chatOpen) return;
    document.documentElement.setAttribute("data-phone-chat", "");
    return () => document.documentElement.removeAttribute("data-phone-chat");
  }, [chatOpen]);

  const rememberInUrl = (thread: ThreadView | null, requestId: string | null, nextTab: Tab) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("fil");
    url.searchParams.delete("demande");
    url.searchParams.delete("onglet");
    if (nextTab === "requests") url.searchParams.set("onglet", "demandes");
    else if (requestId) url.searchParams.set("demande", requestId);
    else if (thread) url.searchParams.set("fil", thread.id);
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

  /** Opening a conversation: it fills the screen, and what the other side wrote is read. */
  const openThread = (thread: ThreadView, requestId: string | null = null, from: Tab = "conversations") => {
    // A phone leaves the list for the conversation: the list's place is kept for the way back.
    if (view === "list" && onPhone()) {
      listScroll.current = window.scrollY;
      window.scrollTo(0, 0);
    }
    setActiveId(thread.id);
    setFocusRequestId(requestId);
    setTab("conversations");
    setOrigin(from);
    setView("chat");
    setNotice(null);
    rememberInUrl(thread, requestId, "conversations");
    if (thread.unread === 0 || readIds.has(thread.id)) return;
    setReadIds((ids) => new Set(ids).add(thread.id));
    if (!writable) return;
    fetch(`/api/conversations/${thread.id}/lu`, { method: "POST" })
      .then((res) => {
        if (res.ok) router.refresh();
      })
      .catch(() => null);
  };

  /** A phone's way back: the list the conversation was opened from, where it was left. */
  const backToList = () => {
    if (onPhone()) restoreScroll.current = listScroll.current;
    setView("list");
    setTab(origin);
    setNotice(null);
    rememberInUrl(null, null, origin);
  };

  /** A request from the tracking view: its conversation, at the request. Without one, its details. */
  const openRequestRow = (request: RequestView) => {
    const thread = request.threadId ? threads.find((t) => t.id === request.threadId) : undefined;
    if (thread) openThread(thread, request.id, "requests");
    else setOpenRequestId(request.id);
  };

  const showTab = (next: Tab) => {
    setTab(next);
    setOrigin(next);
    setNotice(null);
    rememberInUrl(active, next === "conversations" ? focusRequestId : null, next);
  };

  const send = async (thread: ThreadView) => {
    const body = (drafts[thread.id] ?? "").trim();
    if (body === "" || busy) return;
    if (sampleOnly()) return;
    setBusy("send");
    setNotice(null);
    try {
      // A first word to a tenancy opens its conversation; the screen then follows it.
      const target = thread.leaseId && thread.id.startsWith("lease:") ? `/api/baux/${thread.leaseId}/messages` : `/api/conversations/${thread.id}/messages`;
      const res = await fetch(target, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
      if (res.status === 401) return signInAgain();
      const data = (await res.json().catch(() => ({}))) as { conversationId?: string };
      if (!res.ok) {
        setNotice({ tone: "error", text: labels.sendFailed });
        return;
      }
      setDrafts((all) => ({ ...all, [thread.id]: "" }));
      setFocusRequestId(null);
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
      <div className={chatOpen ? "max-lg:hidden" : undefined}>
        <PageHeader title={title} subtitle={subtitle} />
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
      </div>

      {tab === "requests" ? (
        <div role="tabpanel" id="messages-panel-requests" aria-labelledby="messages-tab-requests">
          <RequestsPanel requests={requests} statusOf={statusOf} statusMeta={statusMeta} labels={labels} onOpen={openRequestRow} />
        </div>
      ) : (
        <div role="tabpanel" id="messages-panel-conversations" aria-labelledby="messages-tab-conversations" className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
          <Card className={"overflow-hidden lg:col-span-4" + (chatOpen ? " max-lg:hidden" : "")}>
            {threads.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-ink-soft">{labels.emptyThreads}</p>
            ) : (
              <ul className="divide-y divide-sand-100">
                {threads.map((thread) => (
                  <ThreadRow key={thread.id} thread={thread} unread={unreadOf(thread)} selected={active?.id === thread.id} labels={labels} onOpen={() => openThread(thread)} />
                ))}
              </ul>
            )}
          </Card>

          {active && (
            <Card className={"flex flex-col lg:col-span-8 " + (chatOpen ? PHONE_CHAT : "max-lg:hidden")}>
              <div className="flex items-center gap-2.5 border-b border-sand-100 px-3 py-2.5 lg:gap-3 lg:px-5 lg:py-3.5">
                <button
                  type="button"
                  onClick={backToList}
                  aria-label={backLabel}
                  title={backLabel}
                  className="tactile -ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-brand-700 transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-sand-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 lg:hidden"
                >
                  <Icon name="chevron-left" size={24} />
                </button>
                <span className={"flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold " + (active.isTenancy ? "bg-sky-100 text-sky-800" : "bg-violet-100 text-violet-800")}>
                  {initials(active.participantName) || "·"}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-display text-base font-bold text-ink">{active.participantName}</h2>
                  <p className="truncate text-xs text-ink-soft">{active.isTenancy ? active.scopeLabel : [active.subject, active.scopeLabel].filter(Boolean).join(" · ")}</p>
                </div>
              </div>

              <div ref={bodyRef} id="messages-body" className="relative space-y-3 overflow-y-auto overscroll-y-contain px-4 py-4 max-lg:min-h-0 max-lg:flex-1 lg:h-[62vh] lg:min-h-[26rem] lg:px-5">
                {active.messages.length === 0 && <p className="py-10 text-center text-sm text-ink-soft">{labels.noThreadYet}</p>}
                {active.messages.map((m, i) => {
                  const prev = active.messages[i - 1];
                  const request = m.requestId ? (requestById.get(m.requestId) ?? null) : null;
                  return (
                    <div key={m.id} className="space-y-3">
                      {(!prev || prev.dayLabel !== m.dayLabel) && <DayMark label={m.dayLabel} />}
                      {request ? (
                        <RequestCard
                          request={request}
                          status={statusOf(request)}
                          statusMeta={statusMeta}
                          from={m.from}
                          timeLabel={m.timeLabel}
                          focused={focusRequestId === request.id}
                          badge={labels.requestBadge}
                          view={labels.viewRequest}
                          onView={() => setOpenRequestId(request.id)}
                        />
                      ) : (
                        <MessageBubble message={m} you={labels.you} />
                      )}
                    </div>
                  );
                })}
              </div>

              <form
                className="border-t border-sand-100 p-3 max-lg:pb-[max(0.75rem,env(safe-area-inset-bottom))]"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(active);
                }}
              >
                <div className="flex items-end gap-2">
                  {/* One line high on a phone, like a messaging app's, and 16px: a smaller field makes iOS zoom the page in when it gets the caret. */}
                  <Textarea
                    id="messages-reply"
                    aria-label={labels.replyPlaceholder}
                    placeholder={labels.replyPlaceholder}
                    rows={1}
                    maxLength={4000}
                    className="min-h-0 resize-none max-lg:min-h-11 max-lg:text-base"
                    value={drafts[active.id] ?? ""}
                    onChange={(e) => setDrafts((all) => ({ ...all, [active.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send(active);
                      }
                    }}
                  />
                  <Button type="submit" aria-label={labels.send} title={labels.send} className="h-11 w-11 shrink-0 px-0" loading={busy === "send"} disabled={(drafts[active.id] ?? "").trim() === ""}>
                    {busy !== "send" && <Icon name="send" size={18} />}
                  </Button>
                </div>
                <NoticeLine notice={notice} />
              </form>
            </Card>
          )}
        </div>
      )}

      <div className={chatOpen ? "max-lg:hidden" : undefined}>
        <LegalNote>{legal}</LegalNote>
      </div>

      <Modal open={openRequest !== null} onClose={() => setOpenRequestId(null)} title={labels.detailsTitle} closeLabel={labels.close}>
        {openRequest && (
          <RequestDetails
            request={openRequest}
            status={statusOf(openRequest)}
            interventionId={interventionOf(openRequest)}
            statusMeta={statusMeta}
            labels={labels}
            busy={busy}
            notice={notice}
            onStatus={(status) => void setStatus(openRequest, status)}
            onIntervention={() => void createIntervention(openRequest)}
          />
        )}
      </Modal>
    </div>
  );
}

function NoticeLine({ notice }: { notice: Notice }) {
  return (
    <p
      role="status"
      className={
        "mt-1.5 min-h-4 text-xs font-semibold " +
        (notice?.tone === "error" ? "text-red-700" : notice?.tone === "sample" ? "rounded-lg bg-amber-50 px-2 py-1 text-amber-900" : "text-emerald-800")
      }
    >
      {notice?.text ?? ""}
    </p>
  );
}

function DayMark({ label }: { label: string }) {
  return (
    <p className="text-center text-[11px] font-semibold uppercase tracking-wide text-ink-soft" aria-hidden>
      {label}
    </p>
  );
}

/** A row of the inbox: who, where, the last thing said, when, and what is still unread. Highlighted as the open one on a laptop only. */
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
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={selected ? "true" : undefined}
        className={
          "flex w-full items-start gap-3 border-l-2 border-transparent px-4 py-3 text-left transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-sand-50 active:bg-sand-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 " +
          (selected ? "lg:border-brand-600 lg:bg-brand-50/60" : "")
        }
      >
        <span className={"mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold " + (thread.isTenancy ? "bg-sky-100 text-sky-800" : "bg-violet-100 text-violet-800")}>
          {initials(thread.participantName) || "·"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className={"min-w-0 truncate text-sm text-ink " + (unread > 0 ? "font-bold" : "font-semibold")}>{thread.participantName}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-ink-soft">{thread.lastLabel}</span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-soft">{thread.isTenancy ? thread.scopeLabel : thread.subject}</span>
          <span className="mt-0.5 flex items-center gap-1.5">
            {thread.previewIsRequest && <Badge className="bg-amber-100 text-amber-800">{labels.requestBadge}</Badge>}
            <span className={"min-w-0 flex-1 truncate text-xs " + (unread > 0 ? "font-semibold text-ink" : "text-ink-soft")}>{thread.preview}</span>
            {unread > 0 && (
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent-600" role="img" aria-label={labels.unreadAria.replace("{n}", String(unread))} />
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

function MessageBubble({ message, you }: { message: MessageView; you: string }) {
  const mine = message.kind === "manager";
  if (message.kind === "system") {
    return (
      <div className="flex justify-center">
        <div className="max-w-[85%] rounded-xl border border-dashed border-sand-200 bg-sand-50 px-3.5 py-2 text-center text-xs leading-relaxed text-ink-soft">
          {message.body}
          <span className="ml-1.5 tabular-nums">{message.timeLabel}</span>
        </div>
      </div>
    );
  }
  return (
    <div className={"flex gap-2.5 " + (mine ? "flex-row-reverse" : "")}>
      {!mine && (
        <span className={"mt-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold " + SENDER_COLORS[message.kind]} title={message.from}>
          {initials(message.from) || "·"}
        </span>
      )}
      <div className={"max-w-[78%] " + (mine ? "text-right" : "")}>
        <div className={"inline-block whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-left text-sm leading-relaxed " + (mine ? "rounded-br-md bg-brand-600 text-white" : "rounded-bl-md bg-sand-100 text-ink")}>
          {message.body}
        </div>
        <p className="mt-1 text-[11px] text-ink-soft">
          {mine ? you : message.from} · <span className="tabular-nums">{message.timeLabel}</span>
        </p>
      </div>
    </div>
  );
}

/** A request, where it happened in the conversation: the tenant's side, with what the desk needs at a glance. */
function RequestCard({
  request,
  status,
  statusMeta,
  from,
  timeLabel,
  focused,
  badge,
  view,
  onView,
}: {
  request: RequestView;
  status: RequestStatus;
  statusMeta: Record<RequestStatus, Meta>;
  from: string;
  timeLabel: string;
  focused: boolean;
  badge: string;
  view: string;
  onView: () => void;
}) {
  return (
    <div className="flex gap-2.5" data-request={request.id}>
      <span className="mt-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-[10px] font-bold text-sky-800" title={from}>
        {initials(from) || "·"}
      </span>
      <div className="min-w-0 max-w-[85%] flex-1 sm:min-w-[16rem] sm:flex-none">
        <div className={"rounded-2xl rounded-bl-md border bg-white p-4 transition duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] " + (focused ? "border-brand-300 ring-2 ring-brand-100" : "border-amber-200")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge className="bg-amber-100 text-amber-800">{badge}</Badge>
            <Badge className={statusMeta[status].color}>{statusMeta[status].label}</Badge>
          </div>
          <p className="mt-2 font-display text-sm font-bold text-ink">{request.title}</p>
          {request.description && <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink">{request.description}</p>}
          {request.attachments.length > 0 && (
            <div className="mt-3">
              <AttachmentGrid attachments={request.attachments} />
              {request.attachmentsLabel && <p className="mt-1 text-[11px] text-ink-soft">{request.attachmentsLabel}</p>}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-sand-100 pt-3">
            <span className="text-[11px] tabular-nums text-ink-soft">{request.ref}</span>
            <Button type="button" variant="secondary" size="sm" onClick={onView}>
              {view}
            </Button>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-ink-soft">
          {from} · <span className="tabular-nums">{timeLabel}</span>
        </p>
      </div>
    </div>
  );
}

function AttachmentGrid({ attachments }: { attachments: AttachmentView[] }) {
  return (
    <ul className="grid grid-cols-3 gap-2">
      {attachments.map((a) => (
        <li key={a.id} className="overflow-hidden rounded-xl border border-sand-200 bg-sand-50">
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

/** "Voir la demande": the request's status, its details, its photos, and the way to an intervention. */
function RequestDetails({
  request,
  status,
  interventionId,
  statusMeta,
  labels,
  busy,
  notice,
  onStatus,
  onIntervention,
}: {
  request: RequestView;
  status: RequestStatus;
  interventionId: string | null;
  statusMeta: Record<RequestStatus, Meta>;
  labels: MessagesLabels;
  busy: Busy;
  notice: Notice;
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
    <div>
      <p className="font-display text-base font-bold text-ink">{request.title}</p>
      <p className="text-xs tabular-nums text-ink-soft">{request.ref}</p>
      {request.description && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink">{request.description}</p>}

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
        <NoticeLine notice={notice} />
      </div>
    </div>
  );
}

/** What needs the desk first: open requests, most recently active on top. */
function sortForDesk(requests: RequestView[], statusOf: (r: RequestView) => RequestStatus): RequestView[] {
  return [...requests].sort((a, b) => {
    const openA = isRequestOpen(statusOf(a)) ? 0 : 1;
    const openB = isRequestOpen(statusOf(b)) ? 0 : 1;
    if (openA !== openB) return openA - openB;
    return a.activityAt < b.activityAt ? 1 : -1;
  });
}

/**
 * The tracking view: a table on a laptop, a list of rows a thumb can hit on
 * a phone. Both open the request's conversation at its card.
 */
function RequestsPanel({
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
  const rows = sortForDesk(requests, statusOf);
  return (
    <>
      <Card className="overflow-hidden lg:hidden">
        <ul className="divide-y divide-sand-100">
          {rows.map((r) => (
            <RequestRow key={r.id} request={r} status={statusOf(r)} statusMeta={statusMeta} onOpen={() => onOpen(r)} />
          ))}
        </ul>
      </Card>

      <Card className="hidden overflow-hidden lg:block">
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
                      <button
                        type="button"
                        className="text-left font-semibold text-ink hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                        onClick={(e) => {
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
    </>
  );
}

/** A request as a phone lists it: the subject, who and where, its status and when it last moved. */
function RequestRow({
  request,
  status,
  statusMeta,
  onOpen,
}: {
  request: RequestView;
  status: RequestStatus;
  statusMeta: Record<RequestStatus, Meta>;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-sand-50 active:bg-sand-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600"
      >
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-800">{initials(request.tenantName) || "·"}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className={"min-w-0 truncate text-sm text-ink " + (isRequestOpen(status) ? "font-bold" : "font-semibold")}>{request.title}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-ink-soft">{request.activityLabel}</span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-soft">{[request.tenantName, request.placeLabel].filter(Boolean).join(" · ")}</span>
          <span className="mt-1.5 flex items-center justify-between gap-2">
            <Badge className={statusMeta[status].color}>{statusMeta[status].label}</Badge>
            <span className="text-[11px] tabular-nums text-ink-soft">{request.ref}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

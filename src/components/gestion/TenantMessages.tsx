"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Badge, Card } from "@/components/pro/ui";
import TenantChat, { type TenantChatMessage, type TenantChatRequest } from "@/components/gestion/TenantChat";
import { initials } from "@/lib/types";

/**
 * "Messages" in the tenant's space, laid out for the screen it is on. A
 * laptop keeps what it had: the title, the other conversations as chips
 * under it, the open conversation as a card. A phone reads like a
 * messaging app: the list of conversations alone (the manager, the home,
 * the last word, when), a tap opening one over the whole screen with only
 * the way back and the manager's name at the top and the composer at the
 * foot, the space's bars stepping aside meanwhile (`html[data-phone-chat]`).
 * Every conversation's messages are already here, so switching costs no
 * round trip; the address keeps naming the open one (`?bail=`).
 */

export interface TenantConversationView {
  /** The conversation's id, or the tenancy's own when no word has been written yet. */
  id: string;
  leaseId: string;
  /** "Apt 3B · Résidence Beaulieu" */
  label: string;
  /** For the list: the time today, the day otherwise; nothing before the first word. */
  lastLabel: string;
  preview: string;
  previewIsRequest: boolean;
  messages: TenantChatMessage[];
  /** The way to a new request while this tenancy is in force. */
  newRequestHref: string | null;
}

export type TenantPhoneView = "list" | "chat";

/** Below Tailwind's `lg` (64rem): where the list and the conversation take turns on the screen. */
const PHONE_QUERY = "(max-width: 1023.98px)";
const onPhone = (): boolean => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE_QUERY).matches;

export default function TenantMessages({
  conversations,
  requests,
  managerName,
  initialId,
  initialView,
  focusRequestId,
  title,
  subtitle,
  pickLabel,
  labels,
  backLabel,
  sampleNote,
}: {
  conversations: TenantConversationView[];
  requests: Record<string, TenantChatRequest>;
  managerName: string;
  /** The conversation the page opens on: the one the address named, else the current tenancy's. */
  initialId: string;
  /** On a phone: the list, unless the address named a conversation or a request. */
  initialView: TenantPhoneView;
  focusRequestId: string | null;
  title: string;
  subtitle: string;
  pickLabel: string;
  labels: { empty: string; noneYet: string; write: string; send: string; sent: string; failed: string; view: string; requestBadge: string; newRequest: string };
  backLabel: string;
  sampleNote: string | null;
}) {
  const [view, setView] = useState<TenantPhoneView>(initialView);
  const [activeId, setActiveId] = useState(initialId);
  const [focus, setFocus] = useState<string | null>(focusRequestId);
  /** Where a phone's list was scrolled to when a conversation took the screen, and whether to go back there. */
  const listScroll = useRef(0);
  const restoreScroll = useRef<number | null>(null);

  const active = conversations.find((c) => c.id === activeId) ?? conversations[0] ?? null;
  const others = conversations.filter((c) => c.id !== active?.id);
  // On a phone the conversation has the screen and the rest steps aside; a
  // laptop pays no attention (the classes it drives are `max-lg:` only).
  const chatOpen = view === "chat" && active !== null;

  // The document says a conversation has the phone's screen while it does:
  // the space's bar, bottom bar and sample line read the attribute.
  useEffect(() => {
    if (!chatOpen) return;
    document.documentElement.setAttribute("data-phone-chat", "");
    return () => document.documentElement.removeAttribute("data-phone-chat");
  }, [chatOpen]);

  // A phone's list comes back where it was left, once it is on the screen again.
  useEffect(() => {
    if (view !== "list" || restoreScroll.current === null) return;
    window.scrollTo(0, restoreScroll.current);
    restoreScroll.current = null;
  }, [view]);

  const rememberInUrl = (conversation: TenantConversationView | null) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("bail");
    url.searchParams.delete("demande");
    if (conversation) url.searchParams.set("bail", conversation.leaseId);
    window.history.replaceState(window.history.state, "", url);
  };

  /** Opening a conversation: it fills the phone's screen, on its newest message. */
  const open = (conversation: TenantConversationView) => {
    if (view === "list" && onPhone()) {
      listScroll.current = window.scrollY;
      window.scrollTo(0, 0);
    }
    setActiveId(conversation.id);
    setFocus(null);
    setView("chat");
    rememberInUrl(conversation);
  };

  /** A phone's way back: the list, where it was left, the address clean. */
  const back = () => {
    if (onPhone()) restoreScroll.current = listScroll.current;
    setView("list");
    rememberInUrl(null);
  };

  return (
    <div>
      <div className={chatOpen ? "max-lg:hidden" : undefined}>
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{title}</h1>
          <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>
        </div>

        {/* A laptop: the other conversations as chips, each an address of its own. */}
        {others.length > 0 && (
          <div className="mb-4 max-lg:hidden">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{pickLabel}</p>
            <div className="flex flex-wrap gap-2">
              {others.map((c) => (
                <Link key={c.id} href={`/locataire/messages?bail=${encodeURIComponent(c.leaseId)}`} className="tactile rounded-full border border-sand-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-ink-soft transition hover:border-brand-300 hover:text-brand-700">
                  {c.label}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* A phone: every conversation as a row, the most recent first, a thumb's size. */}
        <Card className="overflow-hidden lg:hidden">
          <ul id="tenant-conversations" className="divide-y divide-sand-100">
            {conversations.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => open(c)}
                  className="tactile flex w-full items-start gap-3 px-4 py-3 text-left transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-sand-50 active:bg-sand-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600"
                >
                  <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">{initials(managerName) || "·"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold text-ink">{managerName}</span>
                      {c.lastLabel && <span className="shrink-0 text-[11px] tabular-nums text-ink-soft">{c.lastLabel}</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink-soft">{c.label}</span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      {c.previewIsRequest && <Badge className="bg-amber-100 text-amber-800">{labels.requestBadge}</Badge>}
                      <span className={"min-w-0 flex-1 truncate text-xs " + (c.preview ? "text-ink-soft" : "italic text-ink-soft/80")}>{c.preview || labels.noneYet}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {active && (
        <TenantChat
          key={active.id}
          leaseId={active.leaseId}
          title={managerName}
          subtitle={active.label}
          messages={active.messages}
          requests={requests}
          labels={labels}
          newRequestHref={active.newRequestHref}
          sampleNote={sampleNote}
          focusRequestId={focus}
          phoneOpen={chatOpen}
          onBack={back}
          backLabel={backLabel}
        />
      )}
    </div>
  );
}

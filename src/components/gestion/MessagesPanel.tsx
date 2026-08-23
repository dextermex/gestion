"use client";

import { useState } from "react";
import { Card } from "@/components/pro/ui";
import { initials } from "@/lib/types";

const SENDER_COLORS: Record<string, string> = {
  tenant: "bg-sky-100 text-sky-800",
  manager: "bg-brand-100 text-brand-800",
  owner: "bg-violet-100 text-violet-800",
  artisan: "bg-amber-100 text-amber-800",
  system: "bg-sand-100 text-ink-soft",
};

export interface ConversationView {
  id: string;
  subject: string;
  scopeLabel: string;
  unread: number;
  messages: Array<{ from: string; kind: string; body: string; timeLabel: string }>;
}

/**
 * Two-pane messaging with real selection state and an honest composer:
 * Enter/submit shows the demo outcome instead of doing nothing.
 */
export function MessagesPanel({
  conversations,
  labels,
}: {
  conversations: ConversationView[];
  labels: { replyPlaceholder: string; send: string; sent: string; unreadAria: string };
}) {
  const [activeId, setActiveId] = useState(conversations[0]?.id);
  const [sentIn, setSentIn] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState("");
  const active = conversations.find((c) => c.id === activeId) ?? conversations[0];

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
      <Card className="overflow-hidden lg:col-span-2">
        <ul className="divide-y divide-sand-100">
          {conversations.map((conv) => {
            const isActive = conv.id === active.id;
            return (
              <li key={conv.id}>
                <button
                  onClick={() => setActiveId(conv.id)}
                  aria-current={isActive ? "true" : undefined}
                  className={
                    "block w-full border-l-2 px-4 py-3 text-left transition hover:bg-sand-50 " +
                    (isActive ? "border-brand-600 bg-brand-50/60" : "border-transparent")
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-semibold text-ink">{conv.subject}</p>
                    {conv.unread > 0 && (
                      <span
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-600 text-[10px] font-bold text-white"
                        aria-label={labels.unreadAria.replace("{n}", String(conv.unread))}
                      >
                        {conv.unread}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-ink-soft">{conv.scopeLabel}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-soft">
                    {conv.messages[conv.messages.length - 1].body}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="flex flex-col lg:col-span-3">
        <div className="border-b border-sand-100 px-5 py-3.5">
          <p className="font-display text-base font-bold text-ink">{active.subject}</p>
          <p className="text-xs text-ink-soft">{active.scopeLabel}</p>
        </div>
        <div className="flex-1 space-y-4 px-5 py-4">
          {active.messages.map((m, i) => (
            <div key={i} className={"flex gap-3 " + (m.kind === "manager" ? "flex-row-reverse" : "")}>
              <span
                className={
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold " +
                  (SENDER_COLORS[m.kind] ?? SENDER_COLORS.system)
                }
                title={m.from}
              >
                {initials(m.from)}
              </span>
              <div className={"max-w-[75%] " + (m.kind === "manager" ? "text-right" : "")}>
                <div
                  className={
                    "inline-block rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed " +
                    (m.kind === "manager"
                      ? "rounded-tr-md bg-brand-600 text-white"
                      : m.kind === "system"
                        ? "rounded-tl-md border border-dashed border-sand-200 bg-sand-50 text-ink-soft"
                        : "rounded-tl-md bg-sand-100 text-ink")
                  }
                >
                  {m.body}
                </div>
                <p className="mt-1 text-[11px] text-ink-soft">
                  {m.from} · {m.timeLabel}
                </p>
              </div>
            </div>
          ))}
          {sentIn[active.id] && (
            <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
              {labels.sent}
            </p>
          )}
        </div>
        <form
          className="border-t border-sand-100 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            setSentIn((v) => ({ ...v, [active.id]: true }));
            setDraft("");
          }}
        >
          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={labels.replyPlaceholder}
              placeholder={labels.replyPlaceholder}
              className="w-full rounded-xl border border-sand-300 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-soft focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
            <button
              type="submit"
              className="tactile shrink-0 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              {labels.send}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}

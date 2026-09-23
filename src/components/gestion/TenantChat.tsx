"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Textarea } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import { initials } from "@/lib/types";

/**
 * The tenant's conversation with their manager: one continuous thread per
 * tenancy, the requests they sent sitting in it as cards. The messages are
 * the rows the desk reads; a message written here goes through the API
 * under the tenant's own session and the page then reads it back.
 */

export interface TenantChatMessage {
  id: string;
  mine: boolean;
  kind: string;
  from: string;
  body: string;
  dayLabel: string;
  timeLabel: string;
  requestId: string | null;
}

export interface TenantChatRequest {
  id: string;
  title: string;
  description: string | null;
  statusLabel: string;
  statusColor: string;
  attachments: Array<{ id: string; name: string; url: string | null }>;
  href: string;
}

export default function TenantChat({
  leaseId,
  title,
  subtitle,
  messages,
  requests,
  labels,
  newRequestHref,
  sampleNote,
  focusRequestId,
}: {
  leaseId: string;
  title: string;
  subtitle: string;
  messages: TenantChatMessage[];
  requests: Record<string, TenantChatRequest>;
  labels: { empty: string; write: string; send: string; sent: string; failed: string; view: string; requestBadge: string; newRequest: string };
  /** The way to a new request while the tenancy is in force. */
  newRequestHref: string | null;
  /** On a sample cabinet, the composer works but nothing is written. */
  sampleNote: string | null;
  focusRequestId: string | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed" | "sample">("idle");
  const bodyRef = useRef<HTMLDivElement>(null);
  const count = messages.length;

  // Opens on the latest message, or on the request the tenant came for.
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
  }, [count, focusRequestId]);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const body = draft.trim();
    if (body === "" || state === "sending") return;
    if (sampleNote) {
      setState("sample");
      return;
    }
    setState("sending");
    try {
      const res = await fetch("/api/locataire/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body, leaseId }) });
      if (res.status === 401) {
        window.location.assign(`/connexion?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      if (!res.ok) {
        setState("failed");
        return;
      }
      setDraft("");
      setState("sent");
      router.refresh();
    } catch {
      setState("failed");
    }
  };

  return (
    <Card className="flex flex-col">
      <div className="flex items-center gap-3 border-b border-sand-100 px-4 py-3 sm:px-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">{initials(title) || "·"}</span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-base font-bold text-ink">{title}</h2>
          <p className="truncate text-xs text-ink-soft">{subtitle}</p>
        </div>
        {newRequestHref && (
          <Link href={newRequestHref} className="tactile shrink-0 rounded-xl border border-sand-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-700 shadow-sm transition hover:border-brand-300">
            {labels.newRequest}
          </Link>
        )}
      </div>

      {/* On a phone the conversation takes what the screen leaves under the space's bar, the title and the composer, so the composer stays in reach. */}
      <div ref={bodyRef} id="tenant-messages-body" className="relative space-y-3 overflow-y-auto overscroll-y-contain px-4 py-4 max-lg:h-[calc(100dvh-25rem)] max-lg:min-h-[14rem] sm:px-5 lg:h-[58vh] lg:min-h-[22rem]">
        {messages.length === 0 && <p className="py-10 text-center text-sm text-ink-soft">{labels.empty}</p>}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const request = m.requestId ? (requests[m.requestId] ?? null) : null;
          return (
            <div key={m.id} className="space-y-3">
              {(!prev || prev.dayLabel !== m.dayLabel) && (
                <p className="text-center text-[11px] font-semibold uppercase tracking-wide text-ink-soft" aria-hidden>
                  {m.dayLabel}
                </p>
              )}
              {request ? (
                <div className="flex justify-end" data-request={request.id}>
                  <div className="max-w-[90%] min-w-[14rem]">
                    <div className={"rounded-2xl rounded-br-md border bg-white p-4 " + (focusRequestId === request.id ? "border-brand-300 ring-2 ring-brand-100" : "border-amber-200")}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Badge className="bg-amber-100 text-amber-800">{labels.requestBadge}</Badge>
                        <Badge className={request.statusColor}>{request.statusLabel}</Badge>
                      </div>
                      <p className="mt-2 font-display text-sm font-bold text-ink">{request.title}</p>
                      {request.description && <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink">{request.description}</p>}
                      {request.attachments.length > 0 && (
                        <ul className="mt-3 grid grid-cols-3 gap-2">
                          {request.attachments.map((a) => (
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
                      )}
                      <div className="mt-3 flex justify-end border-t border-sand-100 pt-3">
                        <Link href={request.href} className="text-sm font-semibold text-brand-700 hover:underline">
                          {labels.view}
                        </Link>
                      </div>
                    </div>
                    <p className="mt-1 text-right text-[11px] text-ink-soft">
                      {m.from} · <span className="tabular-nums">{m.timeLabel}</span>
                    </p>
                  </div>
                </div>
              ) : m.kind === "system" ? (
                <div className="flex justify-center">
                  <div className="max-w-[85%] rounded-xl border border-dashed border-sand-200 bg-sand-50 px-3.5 py-2 text-center text-xs leading-relaxed text-ink-soft">
                    {m.body}
                    <span className="ml-1.5 tabular-nums">{m.timeLabel}</span>
                  </div>
                </div>
              ) : (
                <div className={"flex gap-2.5 " + (m.mine ? "flex-row-reverse" : "")}>
                  {!m.mine && (
                    <span className="mt-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-800" title={m.from}>
                      {initials(m.from) || "·"}
                    </span>
                  )}
                  <div className={"max-w-[80%] " + (m.mine ? "text-right" : "")}>
                    <div className={"inline-block whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-left text-sm leading-relaxed " + (m.mine ? "rounded-br-md bg-brand-600 text-white" : "rounded-bl-md bg-sand-100 text-ink")}>
                      {m.body}
                    </div>
                    <p className="mt-1 text-[11px] text-ink-soft">
                      {m.from} · <span className="tabular-nums">{m.timeLabel}</span>
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <form onSubmit={send} className="border-t border-sand-100 p-3">
        <div className="flex items-end gap-2">
          <Textarea
            id="tenant-message-body"
            aria-label={labels.write}
            placeholder={labels.write}
            rows={1}
            maxLength={4000}
            className="min-h-0 resize-none max-lg:min-h-11 max-lg:text-base"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (state !== "idle" && state !== "sending") setState("idle");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <Button type="submit" aria-label={labels.send} title={labels.send} className="h-11 w-11 shrink-0 px-0" loading={state === "sending"} disabled={draft.trim() === ""}>
            {state !== "sending" && <Icon name="send" size={18} />}
          </Button>
        </div>
        <p
          role="status"
          className={
            "mt-1.5 min-h-4 text-xs font-semibold " +
            (state === "failed" ? "text-red-700" : state === "sample" ? "rounded-lg bg-amber-50 px-2 py-1 text-amber-900" : "text-emerald-800")
          }
        >
          {state === "sent" ? labels.sent : state === "failed" ? labels.failed : state === "sample" ? sampleNote : ""}
        </p>
      </form>
    </Card>
  );
}

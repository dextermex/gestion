"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Modal, Textarea } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import { shrinkPhotos } from "@/lib/photo";
import { SEEN_COOKIE, parseSeen, serializeSeen } from "@/lib/portal/seen";
import { initials } from "@/lib/types";

/**
 * The tenant's conversation with their manager: one continuous thread per
 * tenancy, the requests they sent sitting in it as cards. The messages are
 * the rows the desk reads; a message written here goes through the API
 * under the tenant's own session and the page then reads it back.
 *
 * On a phone the card is a screen of its own (TenantMessages decides when):
 * the space's bar and bottom bar step aside, the way back and the
 * manager's name take the top, the composer the foot.
 *
 * A photo goes with a request, never loose in the thread: the database
 * lets a tenant file a photo on their own request and nowhere else, and
 * that is also where the manager's screens list it. So the camera button
 * asks which open request the photo is about, files it there through the
 * request's own route, and leaves a line in the conversation saying so.
 *
 * Showing the conversation marks it seen on this browser (a cookie holding
 * the tenancy and the last message's time): what the space's navigation
 * counts as unread is what arrived after that.
 */

const MAX_FILES = 5;
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * The conversation filling a phone's whole screen (the page's gutter is
 * gone meanwhile): edge to edge, clear of the notch and the rounded corners
 * by itself, the messages scrolling inside it while the header and the
 * composer stay put. Nothing of this reaches `lg`.
 */
const PHONE_CHAT = "max-lg:h-dvh max-lg:rounded-none max-lg:border-0 max-lg:pt-(--safe-top) max-lg:pl-(--safe-left) max-lg:pr-(--safe-right) max-lg:shadow-none";

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

export interface TenantChatLabels {
  empty: string;
  write: string;
  send: string;
  sent: string;
  failed: string;
  view: string;
  requestBadge: string;
  newRequest: string;
  photo: string;
  photoTitle: string;
  photoPick: string;
  photoNone: string;
  /** "Photo ajoutée à la demande « {title} »." */
  photoMessage: string;
  photoChoose: string;
  photoFailed: string;
  uploading: string;
  close: string;
}

export default function TenantChat({
  leaseId,
  title,
  subtitle,
  messages,
  requests,
  openRequests,
  lastAt,
  labels,
  newRequestHref,
  sampleNote,
  focusRequestId,
  phoneOpen,
  onBack,
  backLabel,
}: {
  leaseId: string;
  title: string;
  subtitle: string;
  messages: TenantChatMessage[];
  requests: Record<string, TenantChatRequest>;
  /** This tenancy's requests still open: where a photo may be filed. */
  openRequests: Array<{ id: string; title: string }>;
  /** When the last message of the conversation was written; empty before the first word. */
  lastAt: string;
  labels: TenantChatLabels;
  /** The way to a new request while the tenancy is in force. */
  newRequestHref: string | null;
  /** On a sample cabinet, the composer works but nothing is written. */
  sampleNote: string | null;
  focusRequestId: string | null;
  /** On a phone: whether the conversation has the screen (else it is not shown there at all). A laptop pays no attention. */
  phoneOpen: boolean;
  /** A phone's way back to the list of conversations. */
  onBack: () => void;
  backLabel: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed" | "sample">("idle");
  const bodyRef = useRef<HTMLDivElement>(null);
  const count = messages.length;
  const [photoOpen, setPhotoOpen] = useState(false);
  const [photoFor, setPhotoFor] = useState<string>(openRequests[0]?.id ?? "");
  const [photoState, setPhotoState] = useState<"idle" | "uploading" | "failed" | "sample">("idle");

  // The conversation is on the screen (always on a laptop, on a phone once it has the screen):
  // this browser has seen it up to its last message. The navigation's count follows on refresh.
  useEffect(() => {
    if (!lastAt) return;
    const wide = typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1024px)").matches;
    if (!phoneOpen && !wide) return;
    const raw = document.cookie.split("; ").find((c) => c.startsWith(`${SEEN_COOKIE}=`))?.slice(SEEN_COOKIE.length + 1);
    const seen = parseSeen(raw);
    if ((seen[leaseId] ?? "") >= lastAt) return;
    document.cookie = `${SEEN_COOKIE}=${serializeSeen({ ...seen, [leaseId]: lastAt })}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [lastAt, leaseId, phoneOpen, router]);

  const sendPhotos = async (input: HTMLInputElement) => {
    const chosen = Array.from(input.files ?? []).filter((f) => f.type.startsWith("image/")).slice(0, MAX_FILES);
    input.value = "";
    const target = openRequests.find((r) => r.id === photoFor) ?? openRequests[0];
    if (chosen.length === 0 || !target) return;
    if (sampleNote) {
      setPhotoState("sample");
      return;
    }
    setPhotoState("uploading");
    try {
      const ready = (await shrinkPhotos(chosen)).filter((f) => f.size <= MAX_BYTES);
      if (ready.length === 0) {
        setPhotoState("failed");
        return;
      }
      const body = new FormData();
      for (const f of ready) body.append("files", f);
      const res = await fetch(`/api/locataire/demandes/${encodeURIComponent(target.id)}/pieces`, { method: "POST", body });
      if (res.status === 401) {
        window.location.assign(`/connexion?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      if (!res.ok) {
        setPhotoState("failed");
        return;
      }
      // The thread says what was filed and where; the photo itself sits on the request's card.
      await fetch("/api/locataire/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: labels.photoMessage.replace("{title}", target.title), leaseId }) }).catch(() => null);
      setPhotoState("idle");
      setPhotoOpen(false);
      router.refresh();
    } catch {
      setPhotoState("failed");
    }
  };

  // Opens on the latest message, or on the request the tenant came for. On
  // a phone the transition includes the conversation taking the screen,
  // which is when it can be scrolled.
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
  }, [count, focusRequestId, phoneOpen]);

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
    <Card className={"flex flex-col " + (phoneOpen ? PHONE_CHAT : "max-lg:hidden")}>
      <div className="flex items-center gap-2.5 border-b border-sand-100 px-3 py-2.5 lg:gap-3 lg:px-5 lg:py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label={backLabel}
          title={backLabel}
          className="tactile -ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-brand-700 transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-sand-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 lg:hidden"
        >
          <Icon name="chevron-left" size={24} />
        </button>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">{initials(title) || "·"}</span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-base font-bold text-ink">{title}</h2>
          <p className="truncate text-xs text-ink-soft">{subtitle}</p>
        </div>
        {newRequestHref && (
          <>
            <Link href={newRequestHref} className="tactile shrink-0 rounded-xl border border-sand-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-700 shadow-sm transition hover:border-brand-300 max-lg:hidden">
              {labels.newRequest}
            </Link>
            {/* The same way to a new request, as a button a thumb can hit, where the header has no room for its words. */}
            <Link
              href={newRequestHref}
              aria-label={labels.newRequest}
              title={labels.newRequest}
              className="tactile flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-brand-700 transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-sand-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 lg:hidden"
            >
              <Icon name="plus" size={22} />
            </Link>
          </>
        )}
      </div>

      <div ref={bodyRef} id="tenant-messages-body" className="relative space-y-3 overflow-y-auto overscroll-y-contain px-4 py-4 max-lg:min-h-0 max-lg:flex-1 sm:px-5 lg:h-[58vh] lg:min-h-[22rem]">
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
                                  <img src={a.url} alt={a.name} loading="lazy" decoding="async" className="aspect-square w-full object-cover" />
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
                        <Link href={request.href} className="text-sm font-semibold text-brand-700 hover:underline max-sm:inline-flex max-sm:min-h-10 max-sm:items-center">
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

      <form onSubmit={send} className="border-t border-sand-100 p-3 max-lg:pb-[max(0.75rem,var(--safe-bottom))]">
        <div className="flex items-end gap-2">
          {newRequestHref && (
            <button
              type="button"
              onClick={() => {
                setPhotoState("idle");
                setPhotoOpen(true);
              }}
              aria-label={labels.photo}
              title={labels.photo}
              className="tactile flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-sand-200 bg-white text-brand-700 transition hover:border-brand-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <Icon name="camera" size={20} className="shrink-0" />
            </button>
          )}
          <Textarea
            id="tenant-message-body"
            aria-label={labels.write}
            placeholder={labels.write}
            rows={1}
            maxLength={4000}
            // Return sends (Enter below), so a phone's return key says so.
            enterKeyHint="send"
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
          {/* `px-0!`: the button's own padding would otherwise squeeze the arrow to a sliver in a 44px circle. */}
          <Button type="submit" aria-label={labels.send} title={labels.send} className="h-11 w-11 shrink-0 px-0!" loading={state === "sending"} disabled={draft.trim() === ""}>
            {state !== "sending" && <Icon name="send" size={18} className="shrink-0" />}
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

      {newRequestHref && (
        <Modal open={photoOpen} onClose={() => setPhotoOpen(false)} title={labels.photoTitle} closeLabel={labels.close}>
          {openRequests.length === 0 ? (
            <div>
              <p className="text-sm leading-relaxed text-ink-soft">{labels.photoNone}</p>
              <Link href={newRequestHref} className="tactile mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-700">
                {labels.newRequest}
              </Link>
            </div>
          ) : (
            <div>
              <fieldset>
                <legend className="mb-2 text-sm text-ink-soft">{labels.photoPick}</legend>
                <div className="space-y-2">
                  {openRequests.map((r) => (
                    <label key={r.id} className={"flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2 text-sm font-semibold text-ink transition " + (photoFor === r.id ? "border-brand-300 bg-brand-50" : "border-sand-200 bg-white hover:border-brand-200")}>
                      <input type="radio" name="tenant-photo-request" value={r.id} checked={photoFor === r.id} onChange={() => setPhotoFor(r.id)} className="h-4 w-4 accent-brand-600" />
                      <span className="min-w-0 flex-1">{r.title}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label
                className={
                  "tactile mt-4 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-700 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600 " +
                  (photoState === "uploading" ? "pointer-events-none opacity-60" : "")
                }
              >
                <Icon name="camera" size={18} className="shrink-0" />
                {photoState === "uploading" ? labels.uploading : labels.photoChoose}
                <input type="file" accept="image/*" multiple className="sr-only" disabled={photoState === "uploading"} onChange={(e) => void sendPhotos(e.currentTarget)} />
              </label>
              <p role="status" className={"mt-2 min-h-4 text-xs font-semibold " + (photoState === "sample" ? "rounded-lg bg-amber-50 px-2 py-1 text-amber-900" : "text-red-700")}>
                {photoState === "failed" ? labels.photoFailed : photoState === "sample" ? sampleNote : ""}
              </p>
            </div>
          )}
        </Modal>
      )}
    </Card>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@/components/pro/ui";
import { Panel } from "@/components/gestion/bits";
import { fmt } from "@/lib/i18n/config";
import type { Meta } from "@/lib/types";
import type { InviteLabels, PartyInvitation } from "@/lib/portal/owner";
import type { InviteState } from "@/lib/portal/types";

/**
 * The owner's control of each tenant's access to their space: the state of
 * the invitation, the sentence that dates it, and the one action that fits
 * (invite, resend, revoke). Sending and revoking change the database; the
 * page is refreshed to read the new state back rather than pretending.
 * When no e-mail could go out, the link is shown here for the owner to pass
 * on, once: it is never listed again afterwards.
 */
type Sent = { email: string; link: string; mailed: boolean };

export default function InvitePanel({
  leaseId,
  sample,
  parties,
  labels,
  stateMeta,
  compact = false,
}: {
  leaseId: string;
  sample: boolean;
  parties: PartyInvitation[];
  labels: InviteLabels;
  stateMeta: Record<InviteState, Meta>;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, Sent>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const send = async (contactId: string) => {
    setBusy(contactId);
    setErrors((e) => ({ ...e, [contactId]: "" }));
    try {
      const res = await fetch("/api/portail/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaseId, contactId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; email?: string; link?: string; sent?: boolean };
      if (res.ok && data.link && data.email) {
        setSent((s) => ({ ...s, [contactId]: { email: data.email!, link: data.link!, mailed: data.sent === true } }));
        router.refresh();
      } else if (res.status === 401) {
        window.location.assign(`/connexion?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      } else {
        const message = data.error === "no_email" ? labels.noEmail : data.error === "not_live" ? labels.notLive : labels.failed;
        setErrors((e) => ({ ...e, [contactId]: message }));
      }
    } catch {
      setErrors((e) => ({ ...e, [contactId]: labels.failed }));
    }
    setBusy(null);
  };

  const revoke = async (contactId: string, inviteId: string) => {
    setBusy(contactId);
    try {
      const res = await fetch(`/api/portail/invitations/${inviteId}`, { method: "DELETE" });
      if (res.ok) {
        setConfirming(null);
        setSent((s) => {
          const next = { ...s };
          delete next[contactId];
          return next;
        });
        router.refresh();
      } else {
        setErrors((e) => ({ ...e, [contactId]: labels.failed }));
      }
    } catch {
      setErrors((e) => ({ ...e, [contactId]: labels.failed }));
    }
    setBusy(null);
  };

  const copy = async (contactId: string, link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(contactId);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard unavailable: the link stays selectable below.
    }
  };

  const rows = (
    <div className="space-y-3">
      {parties.map((p) => {
        const meta = stateMeta[p.state];
        const outcome = sent[p.contactId];
        const error = errors[p.contactId];
        const canResend = p.canInvite && p.state !== "none";
        return (
          <div key={p.contactId} className="rounded-xl border border-sand-200 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
                <p className="truncate text-xs text-ink-soft">{p.email ?? labels.noEmail}</p>
              </div>
              <Badge className={meta.color}>{meta.label}</Badge>
            </div>
            {p.detail && <p className="mt-2 text-xs text-ink-soft">{p.detail}</p>}

            {outcome && (
              <div role="status" className="mt-3 rounded-xl bg-sand-50 p-3">
                <p className={"text-xs font-semibold " + (outcome.mailed ? "text-emerald-800" : "text-amber-800")}>
                  {outcome.mailed ? fmt(labels.mailed, { email: outcome.email }) : labels.notMailed}
                </p>
                <p className="mt-2 text-[11px] font-semibold text-ink-soft">{labels.linkLabel}</p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-semibold text-brand-800">{outcome.link}</code>
                  <button
                    type="button"
                    onClick={() => copy(p.contactId, outcome.link)}
                    className="tactile shrink-0 rounded-lg border border-sand-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-soft hover:border-brand-300 hover:text-brand-700"
                  >
                    {copied === p.contactId ? labels.copied : labels.copy}
                  </button>
                </div>
              </div>
            )}

            {error && (
              <p role="alert" className="mt-2 text-xs font-semibold text-red-700">
                {error}
              </p>
            )}

            {!sample && !p.linked && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {p.canInvite && (
                  <Button size="sm" variant={p.state === "sent" ? "secondary" : "primary"} loading={busy === p.contactId} onClick={() => send(p.contactId)}>
                    {canResend ? labels.resend : labels.invite}
                  </Button>
                )}
                {p.state === "sent" && p.inviteId && confirming !== p.contactId && (
                  <button
                    type="button"
                    disabled={busy === p.contactId}
                    onClick={() => setConfirming(p.contactId)}
                    className="text-xs font-semibold text-red-700 hover:underline disabled:opacity-50"
                  >
                    {labels.revoke}
                  </button>
                )}
                {p.state === "sent" && p.inviteId && confirming === p.contactId && (
                  <span className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold text-ink">{labels.revokeConfirm}</span>
                    <Button size="sm" variant="danger" loading={busy === p.contactId} onClick={() => revoke(p.contactId, p.inviteId!)}>
                      {labels.confirm}
                    </Button>
                    <button type="button" onClick={() => setConfirming(null)} className="font-semibold text-ink-soft hover:text-ink">
                      {labels.cancel}
                    </button>
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  if (compact) {
    return (
      <div className="mt-5 border-t border-sand-100 pt-4">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{labels.title}</p>
        {sample && <p className="mb-3 text-xs text-ink-soft">{labels.sample}</p>}
        {rows}
      </div>
    );
  }
  return (
    <Panel title={labels.title}>
      <p className="mb-3 text-xs leading-relaxed text-ink-soft">{sample ? labels.sample : labels.body}</p>
      {rows}
    </Panel>
  );
}

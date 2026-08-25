"use client";

/**
 * Manager-side tenant-portal card on the lease page: invitation status,
 * generate/copy the onboarding link, revoke. Demo persistence in localStorage;
 * the tenant completing the wizard (same browser) flips the status to active.
 */

import { useEffect, useState } from "react";
import { Badge, Button } from "@/components/pro/ui";
import { Panel } from "@/components/gestion/bits";
import { fmt } from "@/lib/i18n/config";

const INVITES_KEY = "morada_portal_invites_v1";
const ACCOUNT_KEY = "morada_portal_account_v1";

export interface TenantPortalStrings {
  managerTitle: string;
  managerIntro: string;
  statusNotInvited: string;
  statusInvited: string;
  statusActive: string;
  managerGenerate: string;
  managerCopy: string;
  managerCopied: string;
  managerLinkLabel: string;
  managerNote: string;
  managerRevoke: string;
}

type Status = "none" | "invited" | "active";

function readInvites(): Record<string, { invitedAt: string }> {
  try {
    return JSON.parse(localStorage.getItem(INVITES_KEY) ?? "{}") as Record<string, { invitedAt: string }>;
  } catch {
    return {};
  }
}

function readStatus(leaseId: string): Status {
  try {
    const account = JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? "null") as { leaseId?: string } | null;
    if (account?.leaseId === leaseId) return "active";
  } catch {
    /* ignore */
  }
  return readInvites()[leaseId] ? "invited" : "none";
}

export function TenantPortalPanel({
  leaseId,
  tenantName,
  strings,
}: {
  leaseId: string;
  tenantName: string;
  strings: TenantPortalStrings;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setStatus(readStatus(leaseId));
    setOrigin(window.location.origin);
  }, [leaseId]);

  if (status === null) return null;

  const link = `${origin}/portail?invite=${leaseId}`;

  const invite = () => {
    const invites = readInvites();
    invites[leaseId] = { invitedAt: new Date().toISOString() };
    try {
      localStorage.setItem(INVITES_KEY, JSON.stringify(invites));
    } catch {
      /* storage unavailable */
    }
    setStatus("invited");
  };

  const revoke = () => {
    const invites = readInvites();
    delete invites[leaseId];
    try {
      localStorage.setItem(INVITES_KEY, JSON.stringify(invites));
    } catch {
      /* storage unavailable */
    }
    setCopied(false);
    setStatus(readStatus(leaseId) === "active" ? "active" : "none");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard blocked: the link stays visible for manual copy */
    }
  };

  const statusMeta =
    status === "active"
      ? { label: strings.statusActive, color: "bg-emerald-100 text-emerald-800" }
      : status === "invited"
        ? { label: strings.statusInvited, color: "bg-sky-100 text-sky-800" }
        : { label: strings.statusNotInvited, color: "bg-sand-100 text-ink-soft" };

  return (
    <Panel title={strings.managerTitle} action={<Badge className={statusMeta.color}>{statusMeta.label}</Badge>}>
      <p className="text-sm text-ink-soft">{strings.managerIntro}</p>

      {status === "none" && (
        <Button onClick={invite} className="mt-3">
          {strings.managerGenerate}
        </Button>
      )}

      {status === "invited" && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            {fmt(strings.managerLinkLabel, { tenant: tenantName })}
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-sand-200 bg-sand-50 px-2.5 py-2 text-xs text-ink">
              {link}
            </code>
            <Button onClick={copy} variant="secondary" className="shrink-0">
              {copied ? strings.managerCopied : strings.managerCopy}
            </Button>
          </div>
          <button
            type="button"
            onClick={revoke}
            className="mt-2 text-xs font-semibold text-ink-soft hover:text-red-700 hover:underline"
          >
            {strings.managerRevoke}
          </button>
        </div>
      )}

      <p className="mt-3 text-xs text-ink-soft">{strings.managerNote}</p>
    </Panel>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, Button } from "@/components/pro/ui";
import type { Dict } from "@/lib/i18n/fr";

/** Manager-side tenant invitation: send the onboarding link, then copy it. */
export default function TenantInvite({
  d,
  tenantName,
  link,
}: {
  d: Dict;
  tenantName: string;
  link: string;
}) {
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable: the link stays selectable below.
    }
  };

  return (
    <div className="rounded-xl border border-sand-200 p-3.5">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-semibold text-ink">{tenantName}</p>
        <Badge className={sent ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>
          {sent ? d.baux.portalSent : d.baux.portalPending}
        </Badge>
      </div>
      {sent ? (
        <div className="mt-2.5">
          <p className="text-[11px] font-semibold text-ink-soft">{d.baux.portalLinkLabel}</p>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-sand-50 px-2.5 py-1.5 text-[11px] font-semibold text-brand-800">
              {link}
            </code>
            <button
              onClick={copy}
              className="tactile shrink-0 rounded-lg border border-sand-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-soft hover:border-brand-300 hover:text-brand-700"
            >
              {copied ? d.baux.portalCopied : d.baux.portalCopy}
            </button>
          </div>
          <Link href="/locataire/onboarding" className="mt-2 inline-block text-xs font-semibold text-brand-700 hover:underline">
            {d.baux.portalPreview}
          </Link>
        </div>
      ) : (
        <Button size="sm" variant="secondary" className="mt-2.5" onClick={() => setSent(true)}>
          {d.baux.portalInvite}
        </Button>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/pro/ui";
import { useApiProblems } from "./ApiErrors";

/**
 * Runs /api/banking/sync and refreshes the page data. As a button it is the
 * real "Récupérer les opérations"; with `auto`, it fires once on mount, which
 * is how the return from the bank-consent journey pulls the first import
 * without another click.
 */
export default function SyncBank({
  label,
  labels,
  auto = false,
}: {
  label: string;
  labels: { notConfigured: string; failed: string; schemaUnexposed: string };
  auto?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(auto);
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);
  const problems = useApiProblems();

  const sync = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/banking/sync", { method: "POST" });
      if (res.ok) {
        router.refresh();
        setBusy(false);
        return;
      }
      if (res.status === 401) {
        window.location.assign("/connexion?next=/app/banque");
        return;
      }
      // The sync's own sentences for what it knows; the rest by its status (a subscription, a role).
      setError((await problems.read(res, { fallback: labels.failed, codes: { not_configured: labels.notConfigured, schema_unexposed: labels.schemaUnexposed } })).message);
    } catch {
      setError(problems.network({ fallback: labels.failed }).message);
    }
    setBusy(false);
  };

  useEffect(() => {
    if (auto && !ran.current) {
      ran.current = true;
      void sync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  return (
    <div>
      <Button variant="secondary" loading={busy} onClick={sync}>
        {label}
      </Button>
      {error && (
        <p role="alert" className="mt-2 max-w-64 text-xs leading-relaxed text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

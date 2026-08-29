"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/pro/ui";

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
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(
        body.error === "not_configured"
          ? labels.notConfigured
          : body.error === "schema_unexposed"
            ? labels.schemaUnexposed
            : labels.failed,
      );
    } catch {
      setError(labels.failed);
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

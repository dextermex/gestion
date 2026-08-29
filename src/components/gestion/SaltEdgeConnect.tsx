"use client";

import { useState } from "react";
import { Button } from "@/components/pro/ui";

/**
 * The real "connect a bank account" button: asks the server to open a Salt
 * Edge consent session and follows the returned URL. Errors stay next to the
 * button, in words, with a stable meaning per HTTP code.
 */
export default function SaltEdgeConnect({
  label,
  notConfigured,
  failed,
  variant = "primary",
  size = "md",
}: {
  label: string;
  notConfigured: string;
  failed: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/banking/connect", { method: "POST" });
      if (res.ok) {
        const { url } = (await res.json()) as { url: string };
        window.location.assign(url);
        return; // keep the button busy while the journey opens
      }
      if (res.status === 401) {
        window.location.assign("/connexion?next=/app/banque");
        return;
      }
      setError(res.status === 503 ? notConfigured : failed);
    } catch {
      setError(failed);
    }
    setBusy(false);
  };

  return (
    <div>
      <Button variant={variant} size={size} loading={busy} onClick={start}>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path strokeLinecap="round" d="M12 5v14M5 12h14" />
        </svg>
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

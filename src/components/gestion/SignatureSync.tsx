"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Reads the open sendings back from the provider once the page is shown,
 * and refreshes it when a signature, a completion or a refusal came in.
 * Renders nothing; the server reads each sending at most once a minute.
 */
export default function SignatureSync({ envelopeIds }: { envelopeIds: string[] }) {
  const router = useRouter();
  const key = envelopeIds.join(",");
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    fetch("/api/signature/actualiser", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ envelopeIds: key.split(",") }), signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { changed?: number } | null) => {
        if (body && (body.changed ?? 0) > 0) router.refresh();
      })
      .catch(() => null);
    return () => controller.abort();
  }, [key, router]);
  return null;
}

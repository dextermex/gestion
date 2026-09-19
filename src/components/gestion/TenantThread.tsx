"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Textarea } from "@/components/pro/ui";

/** A follow-up on a request: written to the ticket's thread, then read back. */
export default function TenantThread({
  requestId,
  labels,
}: {
  requestId: string;
  labels: { write: string; send: string; sent: string; failed: string };
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (body.trim() === "") return;
    setState("sending");
    try {
      const res = await fetch(`/api/locataire/demandes/${requestId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        setBody("");
        setState("sent");
        router.refresh();
        return;
      }
      if (res.status === 401) {
        window.location.assign(`/connexion?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      setState("failed");
    } catch {
      setState("failed");
    }
  };

  return (
    <form onSubmit={send} className="mt-4 border-t border-sand-100 pt-4">
      <label className="block text-xs font-semibold text-ink-soft" htmlFor="tenant-thread-body">
        {labels.write}
      </label>
      <Textarea id="tenant-thread-body" required maxLength={4000} rows={3} value={body} onChange={(e) => setBody(e.target.value)} className="mt-1.5" />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p role="status" className={"text-xs font-semibold " + (state === "failed" ? "text-red-700" : "text-emerald-800")}>
          {state === "sent" ? labels.sent : state === "failed" ? labels.failed : ""}
        </p>
        <Button type="submit" size="sm" loading={state === "sending"} disabled={body.trim() === ""}>
          {labels.send}
        </Button>
      </div>
    </form>
  );
}

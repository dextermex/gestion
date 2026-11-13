"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/pro/icons";
import { Button, Textarea } from "@/components/pro/ui";

/**
 * A reply from a request's own page: the same message, to the same
 * conversation, through the same route as the Messages screen. Nothing new
 * is stored anywhere else; the page reads the conversation back.
 */
export default function TenantReply({
  leaseId,
  labels,
  sampleNote,
  before,
}: {
  leaseId: string;
  labels: { placeholder: string; send: string; sent: string; failed: string };
  /** On a sample cabinet, the field works but nothing is written. */
  sampleNote: string | null;
  /** What stands before the field: the photo button, on a request still open. */
  before?: React.ReactNode;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed" | "sample">("idle");

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
    <form onSubmit={send} className="mt-4">
      <div className="flex items-end gap-2">
        {before}
        <Textarea
          id="tenant-request-reply"
          aria-label={labels.placeholder}
          placeholder={labels.placeholder}
          rows={1}
          maxLength={4000}
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
        <Button type="submit" aria-label={labels.send} title={labels.send} className="h-11 w-11 shrink-0 px-0!" loading={state === "sending"}>
          {state !== "sending" && <Icon name="send" size={18} className="shrink-0" />}
        </Button>
      </div>
      <p role="status" className={"mt-1.5 min-h-4 text-xs font-semibold " + (state === "failed" ? "text-red-700" : state === "sample" ? "rounded-lg bg-amber-50 px-2 py-1 text-amber-900" : "text-emerald-800")}>
        {state === "sent" ? labels.sent : state === "failed" ? labels.failed : state === "sample" ? sampleNote : ""}
      </p>
    </form>
  );
}

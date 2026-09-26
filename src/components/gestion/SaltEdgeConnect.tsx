"use client";

import { useEffect, useState } from "react";
import { Button, Modal } from "@/components/pro/ui";
import { BANK_RETURN_MESSAGE } from "@/components/gestion/BankReturnRelay";

/**
 * The real "connect a bank account" button: asks the server to open a Salt
 * Edge consent session and runs the returned URL inside the house dialog, on
 * the page, in a frame. The return page, loaded in that frame at the end,
 * posts the bank screen's address up to this page, which closes the dialog
 * and moves there. A link opens the same journey in a tab for a browser that
 * will not frame it; that tab hands its result back the same way.
 *
 * Errors stay next to the button, in words, with a stable meaning per HTTP
 * code and, when the provider refused, per class of refusal: wrong
 * credentials, an app not yet allowed to reach real banks, a request the
 * provider does not take, a signature it expects. The class itself is
 * printed so support can look it up, next to a link to the deployment's own
 * diagnosis.
 */
export interface ConnectLabels {
  notConfigured: string;
  failed: string;
  /** The provider refused the App-id or the Secret. */
  refusedCredentials?: string;
  /** The Salt Edge app is not (yet) allowed to do this: pending, restricted, disabled. */
  appPending?: string;
  /** The provider did not take the request as built. */
  requestInvalid?: string;
  /** The Salt Edge app carries a public key, so the provider expects signed requests. */
  signatureRequired?: string;
  /** "{code}" is the provider's class of refusal. */
  failedWithCode?: string;
  /** Where the deployment's own diagnosis can be read. */
  diagnostic?: string;
  /** What the dialog says while the journey loads. */
  opening?: string;
  /** The link that opens the journey in a tab instead. */
  openTab?: string;
  /** The dialog's close button. */
  close?: string;
}

const CREDENTIALS = new Set(["ApiKeyNotFound", "AppIdNotProvided", "SecretNotProvided", "WrongSecret", "InvalidSecret", "ClientNotFound"]);
const PENDING = new Set(["ClientPending", "ClientRestricted", "ClientDisabled", "ActionNotAllowed", "AccessDenied", "ClientNotApproved", "ProviderInactive", "ProviderDisabled"]);
const REQUEST = new Set(["WrongRequestFormat", "InvalidAttemptReturnTo", "ReturnUrlInvalid", "ProviderNotFound", "CustomerNotFound", "InvalidConsent", "MissingConsent"]);
const SIGNATURE = new Set(["SignatureNotProvided", "InvalidSignature", "ExpiresAtNotProvided", "ExpiresAtInvalid", "RequestExpired", "PublicKeyNotProvided"]);

export function explainConnectFailure(code: string | null, labels: ConnectLabels): string {
  if (code && CREDENTIALS.has(code) && labels.refusedCredentials) return `${labels.refusedCredentials} (${code})`;
  if (code && PENDING.has(code) && labels.appPending) return `${labels.appPending} (${code})`;
  if (code && REQUEST.has(code) && labels.requestInvalid) return `${labels.requestInvalid} (${code})`;
  if (code && SIGNATURE.has(code) && labels.signatureRequired) return `${labels.signatureRequired} (${code})`;
  if (code && labels.failedWithCode) return labels.failedWithCode.replace("{code}", code);
  return labels.failed;
}

export default function SaltEdgeConnect({
  label,
  labels,
  hint,
  variant = "primary",
  size = "md",
}: {
  label: string;
  labels: ConnectLabels;
  /** One quiet line under the button: what this journey is (the demo says so). */
  hint?: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // The return page, on this origin, says where the bank screen continues.
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: unknown; target?: unknown } | null;
      if (!data || data.type !== BANK_RETURN_MESSAGE || typeof data.target !== "string") return;
      if (!data.target.startsWith("/") || data.target.startsWith("//")) return;
      setUrl(null);
      window.location.assign(data.target);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/banking/connect", { method: "POST" });
      if (res.ok) {
        const { url: connectUrl } = (await res.json()) as { url: string };
        setLoaded(false);
        setUrl(connectUrl);
        setBusy(false);
        return;
      }
      if (res.status === 401) {
        window.location.assign("/connexion?next=/app/banque");
        return;
      }
      if (res.status === 503) setError(labels.notConfigured);
      else {
        const payload = (await res.json().catch(() => ({}))) as { code?: string; detail?: string; returnTo?: string };
        let text = explainConnectFailure(typeof payload.code === "string" ? payload.code : null, labels);
        if (typeof payload.detail === "string" && payload.detail) text = `${text} ${payload.detail}`;
        if (typeof payload.returnTo === "string" && payload.returnTo) text = `${text} (return_to: ${payload.returnTo})`;
        setError(text);
      }
    } catch {
      setError(labels.failed);
    }
    setBusy(false);
  };

  return (
    <div>
      <Button variant={variant} size={size} loading={busy} onClick={start} data-connect-bank>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path strokeLinecap="round" d="M12 5v14M5 12h14" />
        </svg>
        {label}
      </Button>
      {hint && (
        <p className="mt-1.5 max-w-72 text-[11px] leading-relaxed text-ink-soft" data-connect-hint>
          {hint}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 max-w-72 text-xs leading-relaxed text-red-700" data-connect-error>
          {error}
          {labels.diagnostic && (
            <>
              {" "}
              <a href="/api/banking/health" className="font-semibold underline" target="_blank" rel="noreferrer">
                {labels.diagnostic}
              </a>
            </>
          )}
        </p>
      )}
      <Modal open={url !== null} onClose={() => setUrl(null)} title={label} wide closeLabel={labels.close ?? "Fermer"}>
        {url && (
          <>
            <div className="relative overflow-hidden rounded-xl border border-sand-200 bg-sand-50" data-connect-dialog>
              {!loaded && (
                <p role="status" className="absolute inset-0 z-10 flex items-center justify-center text-sm text-ink-soft">
                  {labels.opening}
                </p>
              )}
              <iframe
                title="Salt Edge Connect"
                src={url}
                onLoad={() => setLoaded(true)}
                className="relative block h-[70dvh] min-h-[480px] w-full bg-white max-sm:h-[74dvh]"
                referrerPolicy="strict-origin-when-cross-origin"
                data-connect-frame
              />
            </div>
            {labels.openTab && (
              <p className="mt-3 text-xs text-ink-soft">
                {/* The tab keeps its opener so its return can come back here and close it. */}
                <a href={url} target="_blank" rel="opener" className="font-semibold text-brand-700 hover:underline">
                  {labels.openTab}
                </a>
              </p>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}

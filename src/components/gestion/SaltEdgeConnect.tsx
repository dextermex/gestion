"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/pro/ui";
import { BANK_RETURN_MESSAGE } from "@/components/gestion/BankReturnRelay";

/**
 * The real "connect a bank account" button: asks the server to open a Salt
 * Edge consent session and shows the returned URL in a popup window, opened
 * on the click itself so no browser blocks it, then loaded once the server
 * answers (a blocked popup falls back to the tab itself). The return page
 * posts the bank screen's address back here, and this window moves there.
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
  /** What the popup says while the server opens the session. */
  opening?: string;
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

const POPUP_NAME = "morada-saltedge";

/** A centred popup, opened synchronously on the click so browsers allow it; null when blocked. */
function openPopup(): Window | null {
  const width = 480;
  const height = Math.min(800, Math.max(560, window.outerHeight - 80));
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  try {
    return window.open("", POPUP_NAME, `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
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
  const popupRef = useRef<Window | null>(null);
  const watchRef = useRef<number | null>(null);

  const stopWatching = () => {
    if (watchRef.current !== null) {
      window.clearInterval(watchRef.current);
      watchRef.current = null;
    }
  };

  useEffect(() => {
    // The return page, on this origin, says where the bank screen continues.
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: unknown; target?: unknown } | null;
      if (!data || data.type !== BANK_RETURN_MESSAGE || typeof data.target !== "string") return;
      if (!data.target.startsWith("/") || data.target.startsWith("//")) return;
      stopWatching();
      try {
        popupRef.current?.close();
      } catch {
        /* already gone */
      }
      window.location.assign(data.target);
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      stopWatching();
    };
  }, []);

  const start = async () => {
    setBusy(true);
    setError(null);
    const popup = openPopup();
    popupRef.current = popup;
    if (popup) {
      try {
        popup.document.write(
          `<!doctype html><title>Salt Edge</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;font:15px system-ui,sans-serif;color:#3f3a33;background:#fbfaf7"><p>${escapeHtml(labels.opening ?? "")}</p></body>`,
        );
      } catch {
        /* nothing to show yet */
      }
    }
    try {
      const res = await fetch("/api/banking/connect", { method: "POST" });
      if (res.ok) {
        const { url } = (await res.json()) as { url: string };
        if (popup && !popup.closed) {
          popup.location.href = url;
          // Closed by hand before the end: the button is free again.
          watchRef.current = window.setInterval(() => {
            if (popup.closed) {
              stopWatching();
              setBusy(false);
            }
          }, 500);
          return; // busy while the journey runs in the popup
        }
        window.location.assign(url);
        return; // keep the button busy while the journey opens
      }
      popup?.close();
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
      popup?.close();
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
    </div>
  );
}

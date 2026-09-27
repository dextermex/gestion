"use client";
import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SignupCopy } from "@/lib/i18n/signup";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}
export default function Turnstile({ siteKey, onToken, copy, locale }: {
  siteKey: string; onToken: (token: string) => void; copy: SignupCopy; locale: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const tokenCallback = useRef(onToken);
  tokenCallback.current = onToken;
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const render = useCallback(() => {
    if (!container.current || !window.turnstile) return;
    if (widget.current) window.turnstile.remove(widget.current);
    tokenCallback.current("");
    setState("loading");
    widget.current = window.turnstile.render(container.current, {
      sitekey: siteKey, theme: "light", size: container.current.clientWidth < 300 ? "compact" : "flexible", language: locale === "lu" ? "fr" : locale,
      callback: (token: string) => { tokenCallback.current(token); setState("ready"); },
      "expired-callback": () => { tokenCallback.current(""); setState("loading"); },
      "error-callback": () => { tokenCallback.current(""); setState("error"); },
      "timeout-callback": () => { tokenCallback.current(""); setState("error"); },
    });
  }, [siteKey, locale]);

  useEffect(() => {
    render();
    return () => { if (widget.current) window.turnstile?.remove(widget.current); widget.current = null; tokenCallback.current(""); };
  }, [render]);
  return <div className="signup-security">
    <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={render} onError={() => setState("error")} />
    <div ref={container} />
    {state === "loading" && <p role="status">{copy.captchaLoading}</p>}
    {state === "error" && <div role="alert"><p>{copy.captchaError}</p><button className="signup-text-button" type="button" onClick={() => window.turnstile ? render() : window.location.reload()}>{copy.captchaRetry}</button></div>}
  </div>;
}

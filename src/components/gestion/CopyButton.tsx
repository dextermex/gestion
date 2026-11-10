"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/pro/icons";

/**
 * Copies one value (an IBAN, a payment reference) and says so. The value is
 * written to the clipboard on the press itself; where the browser refuses
 * the clipboard, the text is selected in a hidden field and copied the old
 * way, and if that fails too the button simply stays as it was. The
 * confirmation is read out (`role=status`) and fades back after two seconds.
 */
export default function CopyButton({ value, label, copiedLabel, ariaLabel }: { value: string; label: string; copiedLabel: string; ariaLabel: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const done = () => {
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };
  const fallback = () => {
    try {
      const field = document.createElement("textarea");
      field.value = value;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      const ok = document.execCommand("copy");
      field.remove();
      if (ok) done();
    } catch {
      // Nothing to copy with: the value stays on screen to be selected by hand.
    }
  };
  const copy = () => {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(value).then(done, fallback);
    else fallback();
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={ariaLabel}
      className="tactile inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-sand-200 bg-white px-3 text-sm font-semibold text-brand-700 transition hover:border-brand-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
    >
      <Icon name={copied ? "check" : "copy"} size={16} className="shrink-0" />
      <span role="status">{copied ? copiedLabel : label}</span>
    </button>
  );
}

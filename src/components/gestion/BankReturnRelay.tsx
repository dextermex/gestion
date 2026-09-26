"use client";

import { useEffect } from "react";

/** The message the return page sends the window that opened the consent journey. */
export const BANK_RETURN_MESSAGE = "morada:bank-return";

/**
 * The end of the consent journey, as seen from the window Salt Edge sent the
 * visitor back to. Opened as a popup, it hands the bank screen's return
 * address to the opener (same origin only) and closes itself; opened as the
 * page itself, it simply moves there.
 */
export default function BankReturnRelay({ target, label }: { target: string; label: string }) {
  useEffect(() => {
    const opener = window.opener as Window | null;
    if (opener && !opener.closed) {
      try {
        opener.postMessage({ type: BANK_RETURN_MESSAGE, target }, window.location.origin);
        window.close();
        // A window the browser will not close (not opened by a script) moves on itself.
        const timer = window.setTimeout(() => window.location.replace(target), 600);
        return () => window.clearTimeout(timer);
      } catch {
        /* an opener of another origin: fall through and move on */
      }
    }
    window.location.replace(target);
  }, [target]);

  return (
    <p role="status" className="p-6 text-sm text-ink-soft" data-bank-return={target}>
      {label}
    </p>
  );
}

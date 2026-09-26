"use client";

import { useEffect } from "react";

/** The message the return page sends the window that hosts the consent journey. */
export const BANK_RETURN_MESSAGE = "morada:bank-return";

/**
 * The end of the consent journey, as seen from the window Salt Edge sent the
 * visitor back to. Inside the dialog's frame it hands the bank screen's
 * address to the page around it (same origin only); in a tab opened from the
 * dialog it hands it to the opener and closes; as the page itself it simply
 * moves there. Each hand-over has a fallback that moves on anyway.
 */
export default function BankReturnRelay({ target, label }: { target: string; label: string }) {
  useEffect(() => {
    const message = { type: BANK_RETURN_MESSAGE, target };
    const origin = window.location.origin;

    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage(message, origin);
        // A page of this origin around the frame takes over; anything else cannot be reached.
        const timer = window.setTimeout(() => {
          try {
            window.parent.location.replace(target);
          } catch {
            /* a parent of another origin: nothing more to do here */
          }
        }, 800);
        return () => window.clearTimeout(timer);
      } catch {
        /* fall through */
      }
    }

    const opener = window.opener as Window | null;
    if (opener && !opener.closed) {
      try {
        opener.postMessage(message, origin);
        window.close();
        // A window the browser will not close (not opened by a script) moves on itself.
        const timer = window.setTimeout(() => window.location.replace(target), 600);
        return () => window.clearTimeout(timer);
      } catch {
        /* fall through */
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

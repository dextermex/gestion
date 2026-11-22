"use client";

import { useEffect } from "react";

/**
 * Mounted once in the management space and once in the tenant's: while
 * either is open, the access token is renewed before it ends and when the
 * tab comes back to the front, so a session lasts as long as the person
 * works and a form in hand is never lost to an expiry. The browser client
 * is loaded after the page, never with it. Renders nothing.
 */
export default function SessionKeeper() {
  useEffect(() => {
    let stop: (() => void) | undefined;
    let unmounted = false;
    void import("@/lib/supabase/browser")
      .then(({ keepSessionFresh }) => {
        if (!unmounted) stop = keepSessionFresh();
      })
      .catch(() => undefined);
    return () => {
      unmounted = true;
      stop?.();
    };
  }, []);
  return null;
}

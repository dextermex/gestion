"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Keeps a shell's unread count, and the Messages screen under it, current
 * without a reload. The layout renders this once with the signature of
 * what it drew (how many messages wait, when the last one was written);
 * while the tab is visible it asks a light route for the same signature as
 * the database holds it now, every few seconds on the Messages screen,
 * every minute elsewhere, and at once when the window gets the focus back
 * or the tab becomes visible. When the two differ, something arrived or was
 * read on another device: the page is read again, the layout draws the new
 * count and the screen its new rows.
 *
 * No connection is kept open and nothing is asked while the tab is hidden.
 * A refresh the router dropped is asked for again on the next round, a few
 * times at most for one answer, so a route and a layout that disagreed
 * could never keep the page reloading.
 */
const FAST_MS = 15_000;
const SLOW_MS = 60_000;
/** Two rounds closer than this are one (the focus and the visibility events arrive together). */
const MIN_GAP_MS = 3_000;
const MAX_REFRESHES_PER_ANSWER = 3;

export default function UnreadWatch({
  endpoint,
  signature,
  fastOn,
}: {
  /** The light read route: answers `{ signature }`, or a null signature when it cannot say. */
  endpoint: string;
  /** The signature of what the layout rendered. */
  signature: string;
  /** The screen on which a new message is waited for: the rounds are closer there. */
  fastOn: string;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const fast = pathname === fastOn || pathname.startsWith(`${fastOn}/`);
  const shown = useRef(signature);
  shown.current = signature;
  const asked = useRef<{ answer: string; times: number }>({ answer: "", times: 0 });

  useEffect(() => {
    let stopped = false;
    let running = false;
    let last = 0;
    const round = async () => {
      if (stopped || running || document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - last < MIN_GAP_MS) return;
      last = now;
      running = true;
      try {
        const res = await fetch(endpoint, { cache: "no-store" });
        // Signed out, or a base that cannot answer: nothing to compare, and nothing to say here.
        if (res.status === 401) stopped = true;
        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as { signature?: string | null } | null;
        const answer = typeof data?.signature === "string" ? data.signature : null;
        if (stopped || answer === null) return;
        if (answer === shown.current) {
          asked.current = { answer: "", times: 0 };
          return;
        }
        if (asked.current.answer !== answer) asked.current = { answer, times: 0 };
        if (asked.current.times >= MAX_REFRESHES_PER_ANSWER) return;
        asked.current.times += 1;
        router.refresh();
      } catch {
        // Offline for a moment: the next round asks again.
      } finally {
        running = false;
      }
    };
    // Arriving on the Messages screen: the page was just read, the layout's count may be older.
    if (fast) void round();
    const timer = window.setInterval(() => void round(), fast ? FAST_MS : SLOW_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void round();
    };
    const onFocus = () => void round();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [endpoint, fast, router]);

  return null;
}

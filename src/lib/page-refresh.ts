"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

/**
 * Reading the page again, in a way that is not lost. `router.refresh()` is
 * dropped by the app router when the address is written while the refresh
 * is pending (a conversation opened, the back gesture): the screen would
 * then keep what it had, with nothing to say so. This hook remembers that
 * a refresh was asked for until the page has actually answered (`answer`
 * is a value the server renders anew each time, such as the list the page
 * passes down), and asks again when the address moved meanwhile or when
 * nothing came back after a few seconds.
 *
 * It only ever brings the lists and the counts up to date. Nothing a
 * person is waiting to read is loaded this way.
 */
const ASK_AGAIN_MS = 4000;
const MAX_ASKS = 3;

export function usePageRefresh(answer: unknown): { refresh: () => void; reissue: () => void } {
  const router = useRouter();
  const waiting = useRef(false);
  const asks = useRef(0);
  const timer = useRef<number | null>(null);

  const disarm = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const arm = useCallback(() => {
    disarm();
    if (asks.current >= MAX_ASKS) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (!waiting.current) return;
      asks.current += 1;
      router.refresh();
      arm();
    }, ASK_AGAIN_MS);
  }, [disarm, router]);

  // The page answered: what it renders is new.
  useEffect(() => {
    waiting.current = false;
    asks.current = 0;
    disarm();
  }, [answer, disarm]);

  const refresh = useCallback(() => {
    waiting.current = true;
    asks.current = 1;
    router.refresh();
    arm();
  }, [arm, router]);

  /** After the address was written: a refresh still waited for is asked for again. */
  const reissue = useCallback(() => {
    if (waiting.current) router.refresh();
  }, [router]);

  useEffect(() => {
    // The browser moved by itself (back, forward): once the router has taken the new address, ask again.
    const onPop = () => window.setTimeout(reissue, 0);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      disarm();
    };
  }, [disarm, reissue]);

  return { refresh, reissue };
}

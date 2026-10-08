"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * A view that takes a phone's screen over a list (a conversation over the
 * inbox) is a history entry of its own: the phone's back gesture and the
 * browser's back button close it and show the list again, instead of
 * leaving the page. `enter(url)` pushes the entry, `leave(fallback)` pops it
 * when this hook pushed one and otherwise lets the caller move on its own
 * (a conversation the page was opened on has no entry under it). When the
 * browser moves by itself, `onPop` is told the address it landed on and
 * says whether that address names the view (the browser went forward into
 * it), so the next `leave` knows whether there is an entry to pop.
 *
 * The entry is pushed without a state of its own: the app router copies
 * what it keeps there and takes the address as the page's own, so a later
 * refresh reads the page for that address.
 */
export function useViewHistory(onPop: (url: URL) => boolean): { enter: (url: URL) => void; leave: (fallback: () => void) => void } {
  const pushed = useRef(false);
  const handler = useRef(onPop);
  handler.current = onPop;

  useEffect(() => {
    const onPopState = () => {
      pushed.current = handler.current(new URL(window.location.href));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const enter = useCallback((url: URL) => {
    window.history.pushState(null, "", url);
    pushed.current = true;
  }, []);

  const leave = useCallback((fallback: () => void) => {
    if (pushed.current) window.history.back();
    else fallback();
  }, []);

  return { enter, leave };
}

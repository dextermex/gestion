"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * A thin top progress bar shown while a route transition is in flight.
 *
 * The App Router has no route-level Suspense boundaries in this app, so a
 * navigation to an async (Supabase-backed) page leaves the user on the old
 * screen with no feedback until it is fully ready. This gives that feedback
 * without delaying navigation: it starts on an internal link click (or
 * back/forward) and completes the moment the new route commits.
 *
 * Zero dependencies (~1 KB), and it fully stands down under
 * prefers-reduced-motion — no trickle, no width animation, just a static bar
 * that appears and disappears.
 */
// useSearchParams() must sit under a Suspense boundary or Next.js opts the
// entire route out of static rendering. Wrapping here keeps the layouts clean.
export default function NavigationProgress() {
  return (
    <Suspense fallback={null}>
      <NavigationProgressBar />
    </Suspense>
  );
}

function NavigationProgressBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams}`;

  const [width, setWidth] = useState(0);
  const [active, setActive] = useState(false);
  const [reduced, setReduced] = useState(false);

  const activeRef = useRef(false);
  const reducedRef = useRef(false);
  const trickle = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      reducedRef.current = mq.matches;
      setReduced(mq.matches);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const clearTrickle = () => {
    if (trickle.current !== null) {
      window.clearInterval(trickle.current);
      trickle.current = null;
    }
  };

  const start = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setActive(true);
    setWidth(reducedRef.current ? 80 : 8);
    if (!reducedRef.current) {
      clearTrickle();
      // Ease toward 90% so the bar keeps creeping while we wait, but never
      // completes on its own — completion is driven by the route committing.
      trickle.current = window.setInterval(() => {
        setWidth((w) => (w >= 90 ? w : w + Math.max(0.75, (90 - w) * 0.08)));
      }, 300);
    }
  }, []);

  const done = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    clearTrickle();
    setWidth(100);
    hideTimer.current = window.setTimeout(
      () => {
        setActive(false);
        window.setTimeout(() => setWidth(0), 220);
      },
      reducedRef.current ? 0 : 180
    );
  }, []);

  // Complete as soon as the destination route commits.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    done();
  }, [routeKey, done]);

  // Start on internal-link clicks and history navigation.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      const target = e.target as Element | null;
      const anchor = target?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (
        !href ||
        anchor.getAttribute("target") === "_blank" ||
        anchor.hasAttribute("download") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:")
      )
        return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      // External, or a navigation that doesn't change the path/query, is a
      // no-op for the router — don't flash the bar.
      if (url.origin !== window.location.origin) return;
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      )
        return;
      start();
    };
    const onPopState = () => start();
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
    };
  }, [start]);

  useEffect(
    () => () => {
      clearTrickle();
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    },
    []
  );

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-0.5"
    >
      <div
        className="h-full origin-left bg-gradient-to-r from-brand-500 via-brand-400 to-accent-500"
        style={{
          width: `${width}%`,
          opacity: active ? 1 : 0,
          boxShadow: active ? "0 0 8px rgba(31, 124, 142, 0.55)" : "none",
          transition: reduced
            ? "opacity 120ms linear"
            : "width 200ms ease-out, opacity 200ms ease-out",
        }}
      />
    </div>
  );
}

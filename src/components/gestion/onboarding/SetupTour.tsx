"use client";

/**
 * The first entry into a new space, as the iPhone app plays it on Accueil
 * (morada-mobile-app `app/(tabs)/index.tsx` and `src/features/home/Tour.tsx`),
 * laid over the real page:
 *
 *  1. the arrival (`/app?tour=1`, straight after sign-up): the space scales
 *     up from the centre of the screen in about 1.3 s, on the house easing
 *     (no overshoot), and not at all under reduced motion;
 *  2. one stop: the page dims except the next open step's row on the setup
 *     card, a headline says what the step is for and a thin ring draws round
 *     it in 3 s. Its click opens the step; a click elsewhere or Escape moves
 *     on; "Passer" ends the tour;
 *  3. the setup card lit alone until it is used (Escape or "Passer" end it).
 *
 * Seen once per account: `morada_mobile.tour = 1`, written by
 * `POST /api/onboarding/tour`. Afterwards, each return to Accueil with one
 * more step done and the setup still incomplete dims round the card once
 * more and names the next step.
 *
 * Browser memory (localStorage, every access in try/catch):
 *  - `morada.tour.seen` = "1": the tour was seen or skipped on this browser.
 *    It is read before the tour opens (and by the arrival's inline script,
 *    before the first paint), so a browser test that sets it in an init
 *    script never meets the overlay;
 *  - `morada.tour.count`: the setup count the card was last pointed out at.
 *
 * The overlay is a modal dialog for assistive technology: focus moves into
 * it, the page behind is inert while it shows, Escape closes it and focus
 * returns where it was. Nothing holds the keyboard inside it.
 * It never plays on a sample cabinet, in the empty preview, or for a space
 * whose setup is complete (`ShellSetup.guide`, `tourMode`).
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import type { Dict } from "@/lib/i18n/fr";
import { TOUR_COUNT_KEY, TOUR_SEEN_KEY, setupProgress, tourMode, type ShellSetup, type TourMode } from "@/lib/gestion/setup";

const ARRIVAL_MS = 1300;
const PAD = 6;
const GUTTER = 16;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Best effort: without storage the account's flag still holds.
  }
}
const reducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Before the first paint of a hard load of `/app?tour=1`: the arrival starts
 * on the server's HTML, rather than after the page has shown at full size.
 * The component ends it, or cancels it when the tour is not owed.
 */
const ARRIVAL_SCRIPT = `try{var q=new URLSearchParams(location.search);if(location.pathname==="/app"&&q.get("tour")==="1"&&localStorage.getItem(${JSON.stringify(TOUR_SEEN_KEY)})!=="1"&&!matchMedia("(prefers-reduced-motion: reduce)").matches)document.documentElement.setAttribute("data-setup-arrival","")}catch(e){}`;

export function ArrivalScript() {
  return <script dangerouslySetInnerHTML={{ __html: ARRIVAL_SCRIPT }} />;
}

const endArrival = () => document.documentElement.removeAttribute("data-setup-arrival");

type Stop = { kind: "step" | "card"; selector: string; headline: string; label: string; href: string | null };

export default function SetupTour({ d, setup }: { d: Dict; setup: ShellSetup }) {
  const k = d.onboarding;
  const router = useRouter();
  const search = useSearchParams();
  const p = setupProgress(setup.facts);
  const [mode, setMode] = useState<TourMode>("off");
  const [index, setIndex] = useState<number | null>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number; radius: number } | null>(null);
  const [view, setView] = useState({ w: 1024, h: 768 });
  const targetRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const headingId = useId();

  const next = p.next && p.next !== "account" ? p.next : null;
  const stops: Stop[] = [];
  if (mode === "full" && next) stops.push({ kind: "step", selector: `[data-setup-card] [data-setup-step="${next}"]`, headline: k.tour[next], label: k.steps[next], href: setup.hrefs[next] });
  if (mode !== "off") stops.push({ kind: "card", selector: "[data-setup-card]", headline: next && (mode === "card" || p.count > 1) ? k.steps[next] : k.coachTitle, label: next ? k.steps[next] : k.title, href: null });
  const stop = index === null ? null : (stops[index] ?? null);

  // Decided once, when Accueil opens: the full tour, the card again, or nothing.
  useLayoutEffect(() => {
    const arrivalAsked = search.get("tour") === "1";
    if (arrivalAsked) {
      // Played once: a reload does not replay the arrival.
      const url = new URL(window.location.href);
      url.searchParams.delete("tour");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
    const seenHere = read(TOUR_SEEN_KEY) === "1";
    const rawCount = read(TOUR_COUNT_KEY);
    const lastCount = rawCount === null || !Number.isFinite(Number(rawCount)) ? null : Number(rawCount);
    const m = tourMode({ guide: setup.guide, complete: p.complete, seenOnAccount: setup.tourSeen, seenHere, lastCount, count: p.count });
    if (m === "off") {
      endArrival();
      // An account that saw the tour elsewhere starts counting from where the space stands.
      if (setup.guide && lastCount === null) write(TOUR_COUNT_KEY, String(p.count));
      if (setup.guide && setup.tourSeen && !seenHere) write(TOUR_SEEN_KEY, "1");
      return;
    }
    setMode(m);
    const arrival = m === "full" && arrivalAsked && !reducedMotion();
    if (arrival) document.documentElement.setAttribute("data-setup-arrival", "");
    else endArrival();
    const id = window.setTimeout(() => {
      endArrival();
      setIndex(0);
    }, arrival ? ARRIVAL_MS : 400);
    return () => {
      window.clearTimeout(id);
      endArrival();
    };
    // Decided on arrival only: the records do not change under an open page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = stop !== null;
  // While a stop shows: the page behind is inert, and gives focus back afterwards.
  useEffect(() => {
    if (!open) return;
    const shell = document.querySelector<HTMLElement>(".crm-shell");
    returnFocus.current = document.activeElement;
    if (shell) shell.inert = true;
    return () => {
      if (shell) shell.inert = false;
      const back = returnFocus.current;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, [open]);

  // Each stop: its target in view, measured, followed while the page scrolls or resizes, and focus on it.
  useLayoutEffect(() => {
    if (!stop) return;
    const el = document.querySelector<HTMLElement>(stop.selector);
    if (!el) {
      setRect(null);
      return;
    }
    el.scrollIntoView?.({ block: "center", behavior: "instant" as ScrollBehavior });
    let frame = 0;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 12;
      setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD, radius: radius + PAD });
      setView({ w: window.innerWidth, h: window.innerHeight });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
    // The open transition of each stop only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, mode]);

  useEffect(() => {
    if (stop && rect) targetRef.current?.focus({ preventScroll: true });
    // Focus moves on the open transition of a stop only, never on a re-measure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, rect === null]);

  const finish = () => {
    const full = mode === "full";
    setIndex(null);
    setMode("off");
    write(TOUR_SEEN_KEY, "1");
    write(TOUR_COUNT_KEY, String(p.count));
    if (full && !setup.tourSeen) void fetch("/api/onboarding/tour", { method: "POST", credentials: "same-origin", keepalive: true }).catch(() => undefined);
  };
  const advance = () => {
    if (index !== null && index + 1 < stops.length) setIndex(index + 1);
    else finish();
  };

  // Escape moves on, from wherever the focus is.
  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      advanceRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const onTarget = (e: React.MouseEvent) => {
    const current = stop;
    const point = e.detail > 0 ? { x: e.clientX, y: e.clientY } : null;
    finish();
    if (!current) return;
    if (current.kind === "step" && current.href) {
      router.push(current.href);
      return;
    }
    // The card is used: what was under the pointer is clicked, or the keyboard lands on the card's one button.
    window.setTimeout(() => {
      const card = document.querySelector<HTMLElement>("[data-setup-card]");
      const under = point ? document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>("a,button") : null;
      if (card && under && card.contains(under)) under.click();
      else card?.querySelector<HTMLElement>("[data-setup-next]")?.focus();
    }, 0);
  };
  const onBackdrop = () => {
    // The first stop moves on; the card stays lit until it is used, except when it is only pointed out again.
    if (stop?.kind === "step" || mode === "card") advance();
  };

  if (!stop || !rect || typeof document === "undefined") return null;

  const bubbleWidth = Math.min(352, view.w - 2 * GUTTER);
  const left = Math.max(GUTTER, Math.min(rect.left, view.w - GUTTER - bubbleWidth));
  const below = rect.top + rect.height + 16;
  const fitsBelow = below + 150 < view.h;
  const fitsAbove = rect.top - 16 - 150 > 0;
  const bubble: React.CSSProperties = fitsBelow ? { top: below, left } : fitsAbove ? { bottom: view.h - rect.top + 16, left } : { bottom: GUTTER, left };
  const hole: React.CSSProperties = { top: rect.top, left: rect.left, width: rect.width, height: rect.height, borderRadius: rect.radius };

  return createPortal(
    <div className="setup-tour" role="dialog" aria-modal="true" aria-labelledby={headingId} data-setup-tour={stop.kind}>
      <div className="setup-tour-backdrop" onClick={onBackdrop} aria-hidden />
      <div className="setup-tour-hole" style={hole} aria-hidden />
      <svg key={`${mode}-${index}`} className="setup-tour-ring" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} aria-hidden>
        <rect x="1" y="1" width={Math.max(0, rect.width - 2)} height={Math.max(0, rect.height - 2)} rx={Math.max(0, rect.radius - 1)} pathLength={1} fill="none" stroke="#fff" strokeWidth="2" />
      </svg>
      <button ref={targetRef} type="button" className="setup-tour-target" style={hole} aria-label={stop.label} aria-describedby={headingId} onClick={onTarget} />
      <div className="setup-tour-bubble" style={{ ...bubble, width: bubbleWidth }}>
        <p id={headingId} className="font-display text-xl font-bold leading-snug text-white">
          {stop.headline}
        </p>
        <button type="button" onClick={finish} className="mt-3 inline-flex min-h-10 items-center rounded-full bg-white/15 px-4 text-sm font-semibold text-white hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          {k.tour.skip}
        </button>
      </div>
    </div>,
    document.body,
  );
}

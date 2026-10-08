"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * One history entry per wizard step, so the phone's back gesture and the
 * browser's back button return to the previous step instead of leaving the
 * wizard. The step sits in the address (`?etape=n`), so a reload lands on
 * the same step too. Entries this hook pushed are counted: `back` pops one
 * when there is one, and falls back to the wizard's own move when the
 * previous entry is not ours (a wizard reopened on a later step).
 *
 * The history's own state object is handed back to the browser on every
 * push: the app router keeps what it needs there, and the page stays as it
 * is, nothing is fetched again.
 */
export function useStepHistory(
  step: number,
  setStep: (step: number) => void,
  parse: (raw: string | null) => number | null,
  param = "etape",
): { back: (fallback: () => void) => void } {
  const pushed = useRef(0);
  const set = useRef(setStep);
  set.current = setStep;
  const read = useRef(parse);
  read.current = parse;
  const last = useRef<number | null>(null);
  const popping = useRef(false);

  useEffect(() => {
    const onPop = () => {
      const n = read.current(new URLSearchParams(window.location.search).get(param));
      if (n === null) return;
      popping.current = true;
      pushed.current = Math.max(0, pushed.current - 1);
      set.current(n);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [param]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const current = read.current(url.searchParams.get(param));
    if (popping.current) {
      popping.current = false;
      last.current = step;
      return;
    }
    if (current === step) {
      last.current = step;
      return;
    }
    url.searchParams.set(param, String(step));
    if (last.current === null) {
      // The wizard's own first entry: the address says the step, no new entry.
      window.history.replaceState(window.history.state, "", url.toString());
    } else {
      window.history.pushState(window.history.state, "", url.toString());
      pushed.current += 1;
    }
    last.current = step;
  }, [step, param]);

  const back = useCallback((fallback: () => void) => {
    if (pushed.current > 0) window.history.back();
    else fallback();
  }, []);

  return { back };
}

/** A parser for steps that are whole numbers from `min` to `max`. */
export function stepParser(min: number, max: number): (raw: string | null) => number | null {
  return (raw) => {
    if (raw === null || raw === "") return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
  };
}

"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Whether a media query matches, kept in step as it changes (a phone turned
 * sideways). False on the server and wherever `matchMedia` is missing.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener?.("change", notify);
      return () => mq.removeEventListener?.("change", notify);
    },
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  );
}

/** Below Tailwind's `sm` (40rem): where a dialog is a sheet from the foot of the screen. */
export const PHONE_SHEET_QUERY = "(max-width: 639.98px)";

/** Debounce a fast-changing value (search inputs → 250ms). */
export function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** True once the component is mounted (guards SSR-mismatch-prone reads). */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

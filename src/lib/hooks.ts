"use client";

import { useEffect, useState } from "react";

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

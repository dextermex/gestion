"use client";

import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useDismiss } from "@/lib/useDismiss";
import { useLatest } from "@/components/pro/ui";

export default function MobileDrawer({ open, onClose, label, closeLabel, children }: {
  open: boolean;
  onClose: () => void;
  label: string;
  closeLabel: string;
  children: React.ReactNode;
}) {
  const ref = useDismiss<HTMLElement>(open, onClose);
  const close = useLatest(onClose);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("button")?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !ref.current) return;
      const targets = [...ref.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.getClientRects().length > 0);
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (!first) return;
      const outside = !ref.current.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onDesktop = () => { if (desktop.matches) close.current(); };
    document.addEventListener("keydown", onKey);
    desktop.addEventListener("change", onDesktop);
    return () => {
      document.removeEventListener("keydown", onKey);
      desktop.removeEventListener("change", onDesktop);
      document.documentElement.style.overflow = overflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [open, ref, close]);

  return <AnimatePresence>
    {open && <div className="fixed inset-0 z-50 lg:hidden">
      <motion.div className="absolute inset-0 bg-ink/40" aria-hidden
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }} />
      <motion.aside ref={ref} role="dialog" aria-modal aria-label={label}
        className="crm-mobile-sidebar absolute inset-y-0 left-0 w-72 max-w-[calc(100vw-3rem)] bg-white pl-(--safe-left) pt-(--safe-top) shadow-pop"
        initial={reduced ? { opacity: 0 } : { x: -288 }}
        animate={reduced ? { opacity: 1 } : { x: 0 }}
        exit={reduced ? { opacity: 0 } : { x: -288 }}
        transition={reduced ? { duration: 0.15 } : { type: "spring", stiffness: 380, damping: 32 }}>
        <button type="button" onClick={onClose} aria-label={closeLabel}
          className="absolute right-2 top-[max(0.5rem,var(--safe-top))] z-10 flex h-11 w-11 items-center justify-center rounded-lg text-ink-soft hover:bg-sand-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path strokeLinecap="round" d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
        {children}
      </motion.aside>
    </div>}
  </AnimatePresence>;
}

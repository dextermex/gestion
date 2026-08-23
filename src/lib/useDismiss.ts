"use client";

import { useEffect, useRef } from "react";

/**
 * Central dismiss behaviour for every popover / menu / dropdown / floating panel.
 *
 * Attach the returned ref to the element that WRAPS BOTH the trigger and the
 * floating content (typically the existing `relative` container). Then:
 *   - a pointer down anywhere outside that element closes it (mouse + touch +
 *     pen, via a single `pointerdown`);
 *   - pressing Escape closes it;
 *   - pointing inside the trigger or the content never closes it, so the
 *     trigger's own onClick keeps toggling and inner controls (dropdowns, date
 *     pickers…) keep working;
 *   - opening another dismissible closes this one automatically, because that
 *     other trigger lies outside this container.
 *
 * Listeners are attached only while `open` and removed on close/unmount, so
 * there is never a stray, un-cleaned listener. No `stopPropagation` is needed:
 * the handler only reads whether the target is contained, it never swallows the
 * event — so a click on modal content that happens to also close an inner
 * dropdown does not close the modal.
 */
export function useDismiss<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onDismiss: () => void
): React.RefObject<T | null> {
  const ref = useRef<T>(null);
  const cb = useRef(onDismiss);
  cb.current = onDismiss;

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      const el = ref.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) cb.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") cb.current();
    };

    // Capture phase so an outside pointerdown is still detected even if an inner
    // element stops propagation; fires before `click`, so the panel is gone
    // before any sibling's click handler runs.
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return ref;
}

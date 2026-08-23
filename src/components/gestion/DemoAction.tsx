"use client";

import { useState } from "react";

/**
 * A demo-honest action button: on click it performs its visual state change
 * and shows the outcome inline, instead of silently doing nothing. In
 * production the same component wires to the real mutation.
 */
export function DemoAction({
  label,
  doneMessage,
  variant = "primary",
  className,
}: {
  label: string;
  doneMessage: string;
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const [done, setDone] = useState(false);
  if (done) {
    return (
      <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
        {doneMessage}
      </p>
    );
  }
  return (
    <button
      onClick={() => setDone(true)}
      className={
        (variant === "primary"
          ? "tactile rounded-xl bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
          : "tactile rounded-xl border border-sand-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:border-brand-300 hover:text-brand-700") +
        (className ? ` ${className}` : "")
      }
    >
      {label}
    </button>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/pro/ui";

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
    <Button variant={variant} onClick={() => setDone(true)} className={className}>
      {label}
    </Button>
  );
}

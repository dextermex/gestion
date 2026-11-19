"use client";

import type { ReactNode } from "react";

/** Opens one of the shell's creation sheets from a screen's own action row. */
export const CREATE_EVENT = "morada:create";

export default function HeroCreate({ kind, className, children }: { kind: string; className?: string; children: ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new CustomEvent(CREATE_EVENT, { detail: kind }))}>
      {children}
    </button>
  );
}

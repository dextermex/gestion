"use client";

import Link from "next/link";
import { Button } from "@/components/pro/ui";
import type { Dict } from "@/lib/i18n/fr";

/**
 * The two pieces every wizard step is built from, declared once at module
 * scope. A component declared inside the wizard would be a new component on
 * every render, and React would unmount and remount everything under it,
 * inputs included, on each keystroke: the field loses focus after one
 * character. Here the wizard passes what changes as props; the component's
 * identity never does.
 */

/** The step's white card. */
export function StepCard({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm">{children}</div>;
}

/**
 * The same three moves on every step: back (a link out of the wizard on the
 * first step, a step back afterwards), save and continue later, next. Next
 * is a plain button; a form's submit (the Enter key) calls the same move, so
 * a click never saves twice.
 */
export function WizardFooter({
  d,
  backHref,
  onBack,
  busy,
  leaving,
  canSaveLater = true,
  onSaveLater,
  onNext,
  nextLabel,
  canNext = true,
}: {
  d: Dict;
  /** Where "back" leads on the first step; afterwards it is a step back. */
  backHref: string | null;
  onBack: () => void;
  /** A save in flight: the moves wait for it. */
  busy: boolean;
  /** The save-and-leave move in flight, to mark that button and not the next one. */
  leaving: boolean;
  canSaveLater?: boolean;
  onSaveLater: () => void;
  onNext?: () => void;
  nextLabel?: string;
  canNext?: boolean;
}) {
  return (
    <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
      {backHref ? (
        <Link
          href={backHref}
          className="tactile inline-flex min-h-9 items-center justify-center rounded-xl px-3 py-1.5 text-sm font-semibold text-ink-soft hover:text-ink"
        >
          {d.common.back}
        </Link>
      ) : (
        <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
          {d.common.back}
        </Button>
      )}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <Button type="button" variant="secondary" onClick={onSaveLater} disabled={!canSaveLater || busy} loading={leaving}>
          {d.location.saveLater}
        </Button>
        {onNext && (
          <Button type="button" onClick={onNext} disabled={!canNext || busy} loading={busy && !leaving}>
            {nextLabel ?? d.common.next}
          </Button>
        )}
      </div>
    </div>
  );
}

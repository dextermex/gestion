"use client";

import Link from "next/link";
import { Button } from "@/components/pro/ui";
import { draftDate } from "@/lib/draft";
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
  return <div className="journey-step-card mx-auto mt-8 max-w-xl rounded-2xl border border-sand-200 bg-white p-6 shadow-sm">{children}</div>;
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
    <div className="journey-footer mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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

/**
 * The device holds a draft of this wizard, written as the owner went: offer
 * to pick it up where it stopped, or to start again. Shown until the first
 * change, never on a laptop that has no draft.
 */
export function DraftPrompt({ d, savedAt, onResume, onDiscard }: { d: Dict; savedAt: number; onResume: () => void; onDiscard: () => void }) {
  return (
    <div
      role="status"
      data-draft-prompt
      className="mx-auto mt-6 flex max-w-xl flex-col gap-3 rounded-2xl border border-brand-200 bg-brand-50 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-sm text-ink">{d.common.draftFound.replace("{date}", draftDate(savedAt))}</p>
      <div className="flex shrink-0 gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDiscard}>
          {d.common.draftDiscard}
        </Button>
        <Button type="button" size="sm" onClick={onResume}>
          {d.common.draftResume}
        </Button>
      </div>
    </div>
  );
}

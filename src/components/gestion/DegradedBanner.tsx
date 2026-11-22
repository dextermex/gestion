"use client";

import { useRouter } from "next/navigation";

/**
 * Said when part of the account's data could not be read: the screen may be
 * incomplete, and an empty list is not proof of an empty account. One line
 * under the bar, and a way to read again.
 */
export default function DegradedBanner({ text, retry }: { text: string; retry: string }) {
  const router = useRouter();
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-red-200 bg-red-50 px-safe-4 py-2 text-center text-xs font-semibold text-red-800 max-lg:[html[data-phone-chat]_&]:hidden"
    >
      <span>{text}</span>
      <button
        type="button"
        onClick={() => router.refresh()}
        className="inline-flex min-h-8 items-center rounded px-1 underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 max-sm:min-h-11"
      >
        {retry}
      </button>
    </div>
  );
}

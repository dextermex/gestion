"use client";

import { RouteError } from "@/components/RouteFallback";

/** A screen outside the two spaces, or a space's own frame, failed to render: said in the person's language, inside the root layout. */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="px-safe-4 pb-12">
      <RouteError error={error} reset={reset} space="root" />
    </main>
  );
}

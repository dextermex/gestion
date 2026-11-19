"use client";

import { RouteError } from "@/components/RouteFallback";

/** A manager screen failed to render: the shell stays, the screen says so and offers to try again. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} space="manager" />;
}

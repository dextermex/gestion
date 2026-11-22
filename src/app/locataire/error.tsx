"use client";

import { RouteError } from "@/components/RouteFallback";

/** A tenant screen failed to render: the header and the tabs stay, the screen says so and offers to try again. */
export default function TenantError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} space="tenant" />;
}

"use client";

import * as Sentry from "@sentry/nextjs";
import { useRouter } from "next/navigation";
import { createContext, startTransition, useContext, useEffect } from "react";
import { Button } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";

/**
 * The words of an error screen. An error boundary is a client component and
 * cannot read the dictionaries: the root layout reads them for the person's
 * language and hands these few lines down, so the screen that replaces a
 * failed page speaks the language of the rest of the app.
 */
export interface ErrorCopy {
  title: string;
  body: string;
  retry: string;
  /** The way back, by space: the manager's home, the tenant's, the door that routes by session. */
  toHome: string;
  toTenantHome: string;
  toSpace: string;
}

const Copy = createContext<ErrorCopy | null>(null);

export function ErrorCopyProvider({ copy, children }: { copy: ErrorCopy; children: React.ReactNode }) {
  return <Copy.Provider value={copy}>{children}</Copy.Provider>;
}

const BACK = { manager: "/app", tenant: "/locataire", root: "/" } as const;

/**
 * What a route's `error.tsx` renders: what happened, one way to try again
 * and one way back. The error is reported (scrubbed, see
 * src/lib/monitoring.ts). Trying again reads the page from the server once
 * more before the boundary lets it render.
 */
export function RouteError({ error, reset, space }: { error: Error & { digest?: string }; reset: () => void; space: keyof typeof BACK }) {
  const copy = useContext(Copy);
  const router = useRouter();
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  if (!copy) throw error;
  const back = space === "manager" ? copy.toHome : space === "tenant" ? copy.toTenantHome : copy.toSpace;
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <div role="alert" className={"ui-empty flex flex-col items-center justify-center gap-3 rounded-2xl border border-sand-200 bg-white px-6 py-16 text-center" + (space === "root" ? " mx-auto mt-[12vh] max-w-lg" : "")}>
      <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-white text-brand-600 shadow-sm">
        <Icon name="alert" size={22} />
      </span>
      <h1 className="font-display text-xl font-bold text-ink">{copy.title}</h1>
      <p className="max-w-sm text-sm text-ink-soft">{copy.body}</p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <Button onClick={retry}>{copy.retry}</Button>
        {/* A plain navigation: the way back must work even when the client router is what failed. */}
        <a href={BACK[space]} className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
          {back}
        </a>
      </div>
    </div>
  );
}

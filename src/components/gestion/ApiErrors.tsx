"use client";

import { createContext, useContext, useMemo } from "react";
import { apiProblem, type ApiErrorCopy, type ApiProblem, type ApiProblemOptions } from "@/lib/api-errors";

/**
 * The refusal sentences, at hand for every form of the manager space.
 *
 * Most forms receive a handful of labels, not the dictionary. The layout
 * gives the sentences once (`<ApiErrorsProvider copy={d.apiErrors}>`), a form
 * asks `useApiProblems()` and reads what a refusal means: see
 * `src/lib/api-errors.ts` for the rules. Outside a provider (a test, a screen
 * of another space) a problem reads as the form's own line, as it did before.
 */
const Copy = createContext<ApiErrorCopy | null>(null);

export function ApiErrorsProvider({ copy, children }: { copy: ApiErrorCopy; children: React.ReactNode }) {
  return <Copy.Provider value={copy}>{children}</Copy.Provider>;
}

export interface ApiProblems {
  /** The problem behind a refusal already read: its status and its parsed body. */
  of: (status: number, body: unknown, options?: ApiProblemOptions) => ApiProblem;
  /** The problem behind a response that is not `ok`. */
  read: (res: Response, options?: ApiProblemOptions) => Promise<ApiProblem>;
  /** The problem behind a request that never got an answer. */
  network: (options?: ApiProblemOptions) => ApiProblem;
  /** The label of a "try again" control, "" outside a provider. */
  retry: string;
}

/** With no sentences at hand, the form's own line stands for every refusal. */
function plain(status: number, body: unknown, options: ApiProblemOptions = {}): ApiProblem {
  const payload = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const code = typeof payload.error === "string" ? payload.error : "";
  return { kind: "generic", status, code, field: null, message: options.codes?.[code] ?? options.fallback ?? "", link: null };
}

export function useApiProblems(): ApiProblems {
  const copy = useContext(Copy);
  return useMemo(() => {
    const of = (status: number, body: unknown, options?: ApiProblemOptions) =>
      copy ? apiProblem(status, body, copy, options) : plain(status, body, options);
    return {
      of,
      read: async (res: Response, options?: ApiProblemOptions) => of(res.status, await res.json().catch(() => null), options),
      network: (options?: ApiProblemOptions) => of(0, null, options),
      retry: copy?.retry ?? "",
    };
  }, [copy]);
}

/** A problem as a form shows it: the sentence, and the way out when there is one. */
export function ApiProblemNote({ problem, className }: { problem: ApiProblem | null; className?: string }) {
  if (!problem || !problem.message) return null;
  return (
    <p role="alert" className={className ?? "rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"}>
      {problem.message}
      {problem.link && (
        <>
          {" "}
          <a
            href={problem.link.href}
            target={problem.link.newTab ? "_blank" : undefined}
            rel={problem.link.newTab ? "noopener" : undefined}
            className="underline underline-offset-2 hover:no-underline max-sm:inline-flex max-sm:min-h-10 max-sm:items-center"
          >
            {problem.link.label}
          </a>
        </>
      )}
    </p>
  );
}

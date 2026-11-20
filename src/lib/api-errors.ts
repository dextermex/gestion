import { fmt } from "@/lib/i18n/config";
import type { Dict } from "@/lib/i18n/fr";

/**
 * What a refused request is told in words.
 *
 * Every route of the application answers a refusal the same way: an HTTP
 * status and a JSON body `{ error: "<code>", field?: "<name>" }`. A form used
 * to read `res.ok` and print one sentence for every refusal ("the save
 * failed, try again"), whatever the reason. This module reads the status and
 * the code once and gives the sentence that fits, in the reader's language:
 *
 *   401  the session ended: sign in again (beside the form when it still
 *        holds what was typed, so nothing is lost)
 *   402  a subscription is needed to write
 *   403  the role does not allow it (or the data on screen is a sample)
 *   404  the item is gone
 *   409  what conflicts, by the route's code
 *   413  the file is too large, with the limit
 *   415  the type of file is not accepted
 *   400, 422  which field, when the route names one
 *   503 `schema_outdated`  the feature is not available yet
 *   anything else, and a request that never arrived: one plain line
 *
 * It is pure: it takes the sentences (`dict.apiErrors`) and returns the
 * problem. A component with the whole dictionary passes `d.apiErrors`; one
 * that only has labels reads it with `useApiProblems()`
 * (src/components/gestion/ApiErrors.tsx).
 */

export type ApiErrorCopy = Dict["apiErrors"];

export type ApiProblemKind =
  | "session"
  | "subscription"
  | "forbidden"
  | "sample"
  | "notFound"
  | "conflict"
  | "tooLarge"
  | "unsupported"
  | "invalid"
  | "nothing"
  | "unavailable"
  | "network"
  | "generic";

export interface ApiProblem {
  kind: ApiProblemKind;
  /** The HTTP status; 0 when the request never got an answer. */
  status: number;
  /** The route's own code (`error` in the body), "" when it gave none. */
  code: string;
  /** The field the route named, if any. */
  field: string | null;
  /** The sentence to show. */
  message: string;
  /** Where the reader can act on it: sign in again, see the subscription. */
  link: { href: string; label: string; newTab: boolean } | null;
}

export interface ApiProblemOptions {
  /** The form's own sentences for codes it knows, by the route's `error`: they win over the general ones. */
  codes?: Record<string, string>;
  /** The form's field labels, by the name the route answers in `field`. */
  fields?: Record<string, string>;
  /** The upload limit of the form, in megabytes. */
  maxMb?: number;
  /** Where the person returns after signing in again. Defaults to the page they are on. */
  returnTo?: string;
  /** The form still holds what was typed: signing in opens beside it instead of replacing it. */
  keepsInput?: boolean;
  /** The form's own line for a refusal nothing more can be said about. Defaults to the general one. */
  fallback?: string;
}

/** Codes that say the same thing under several names. */
const SAME_AS: Record<string, string> = {
  lease_not_live: "not_live",
  no_live_lease: "not_live",
  // An update that names the version it read, refused because the row moved on (or is gone).
  conflict_or_not_found: "changed",
  already_ended: "lease_ended",
};

/** The sign-in page, returning to `returnTo` (an internal path) afterwards. */
export function signInHref(returnTo: string): string {
  return `/connexion?next=${encodeURIComponent(returnTo)}`;
}

function here(): string {
  return typeof window === "undefined" ? "/app" : window.location.pathname + window.location.search;
}

function kindOf(status: number, code: string): ApiProblemKind {
  if (status === 0) return "network";
  if (status === 401) return "session";
  if (status === 402) return "subscription";
  if (status === 403) return code === "sample_read_only" ? "sample" : "forbidden";
  if (status === 404) return "notFound";
  if (status === 409) return "conflict";
  if (status === 413) return "tooLarge";
  if (status === 415) return "unsupported";
  if (status === 400 || status === 422) return code === "nothing_to_update" ? "nothing" : "invalid";
  if (status === 503 && (code === "schema_outdated" || code === "schema_unexposed")) return "unavailable";
  return "generic";
}

/**
 * The problem behind a refusal: `status` is the HTTP status, `body` the
 * parsed JSON answer (anything else is read as no body).
 */
export function apiProblem(status: number, body: unknown, copy: ApiErrorCopy, options: ApiProblemOptions = {}): ApiProblem {
  const payload = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const code = typeof payload.error === "string" ? payload.error : "";
  // A route names the field as `field`; the settings route as `problem`.
  const field = typeof payload.field === "string" ? payload.field : typeof payload.problem === "string" ? payload.problem : null;
  const kind = kindOf(status, code);
  const base = { kind, status, code, field };
  const own = code ? options.codes?.[code] : undefined;

  if (kind === "session") {
    const keeps = options.keepsInput === true;
    return {
      ...base,
      message: own ?? (keeps ? copy.sessionKeep : copy.session),
      link: { href: signInHref(options.returnTo ?? here()), label: copy.signIn, newTab: keeps },
    };
  }
  if (kind === "subscription") {
    return {
      ...base,
      message: own ?? copy.subscription,
      link: { href: "/app/abonnement", label: copy.subscriptionLink, newTab: options.keepsInput === true },
    };
  }
  return { ...base, message: own ?? sentence(kind, code, field, payload, copy, options), link: null };
}

function sentence(
  kind: ApiProblemKind,
  code: string,
  field: string | null,
  payload: Record<string, unknown>,
  copy: ApiErrorCopy,
  options: ApiProblemOptions,
): string {
  switch (kind) {
    case "forbidden":
      return copy.forbidden;
    case "sample":
      return copy.sample;
    case "notFound":
      return copy.notFound;
    case "conflict": {
      const known = copy.conflicts as Record<string, string>;
      return known[SAME_AS[code] ?? code] ?? copy.conflict;
    }
    case "tooLarge": {
      const max = options.maxMb ?? (typeof payload.maxMb === "number" ? payload.maxMb : undefined);
      return max === undefined ? copy.tooLarge : fmt(copy.tooLargeMax, { max });
    }
    case "unsupported":
      return copy.unsupportedType;
    case "invalid": {
      const label = field ? options.fields?.[field] : undefined;
      return label ? fmt(copy.invalidField, { field: label }) : copy.invalid;
    }
    case "nothing":
      return copy.nothing;
    case "unavailable":
      return copy.unavailable;
    case "network":
      return copy.network;
    default:
      return options.fallback ?? copy.generic;
  }
}

/** The problem behind a response that is not `ok`. Reads the body once; a body that is not JSON is read as none. */
export async function readApiProblem(res: Response, copy: ApiErrorCopy, options: ApiProblemOptions = {}): Promise<ApiProblem> {
  const body: unknown = await res.json().catch(() => null);
  return apiProblem(res.status, body, copy, options);
}

/** The problem behind a request that never got an answer (the network, a closed laptop). */
export function networkProblem(copy: ApiErrorCopy): ApiProblem {
  return apiProblem(0, null, copy);
}

/**
 * A refusal carried as an exception, for a save that is awaited through a
 * callback (`onSave`): the form that catches it shows `problem.message`
 * instead of its general line.
 */
export class ApiRefusal extends Error {
  readonly problem: ApiProblem;
  constructor(problem: ApiProblem) {
    super(problem.message);
    this.name = "ApiRefusal";
    this.problem = problem;
  }
}

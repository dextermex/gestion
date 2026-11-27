import type { DemoData } from "@/lib/demo";
import { isLettable } from "@/lib/gestion/portfolio";

/**
 * The guided first entry into a landlord's space, as the iPhone app has it
 * (morada-mobile-app `src/lib/setup.ts`, Revolut's "Finish setting up"):
 * five steps that turn an empty space into a working one, read from the
 * workspace's own records, never from a flag that could drift from them.
 * The account is the first and is always done, so the ring never starts at
 * zero.
 *
 * What counts, on the web:
 * - a property: any property of the workspace;
 * - a lease: a tenancy in force (`active` or `notice`). A dossier still in
 *   preparation (`draft`) does not count: nothing is let yet, no rent is
 *   followed. On the web the rental flow that creates the lease also records
 *   its tenant, so the step names both, the way the app's copy does;
 * - the bank: one connected account;
 * - the invitation: an invitation to the tenant space that was not revoked
 *   (waiting or accepted).
 */

export type SetupStep = "account" | "property" | "lease" | "bank" | "invite";
export const SETUP_STEPS: readonly SetupStep[] = ["account", "property", "lease", "bank", "invite"];
/** What a step cannot be done without: a lease is for a home, an invitation is for a lease. The bank stands alone. */
export const SETUP_NEEDS: Partial<Record<SetupStep, SetupStep>> = { lease: "property", invite: "lease" };

/** The facts the five steps read: the account is always there. */
export type SetupFacts = Record<Exclude<SetupStep, "account">, boolean>;
export type SetupHrefs = Record<Exclude<SetupStep, "account">, string>;

export interface SetupProgress {
  done: Record<SetupStep, boolean>;
  /** Open, but waiting for the step it depends on: shown greyed, never offered. */
  locked: Record<SetupStep, boolean>;
  count: number;
  total: number;
  /** The first step still open, in order. */
  next: SetupStep | null;
  complete: boolean;
}

export function setupProgress(f: SetupFacts): SetupProgress {
  const done: Record<SetupStep, boolean> = { account: true, ...f };
  const count = SETUP_STEPS.filter((s) => done[s]).length;
  const locked = Object.fromEntries(
    SETUP_STEPS.map((s) => {
      const need = SETUP_NEEDS[s];
      return [s, !done[s] && need !== undefined && !done[need]];
    }),
  ) as Record<SetupStep, boolean>;
  return { done, locked, count, total: SETUP_STEPS.length, next: SETUP_STEPS.find((s) => !done[s]) ?? null, complete: count === SETUP_STEPS.length };
}

type Records = Pick<DemoData, "PROPERTIES" | "UNITS" | "LEASES" | "BANK_ACCOUNTS" | "INVITES">;

const live = (status: string) => status === "active" || status === "notice";

export function setupFacts(r: Records): SetupFacts {
  return {
    property: r.PROPERTIES.length > 0,
    lease: r.LEASES.some((l) => live(l.status)),
    bank: r.BANK_ACCOUNTS.length > 0,
    invite: r.INVITES.some((i) => !i.revokedAt),
  };
}

/**
 * Where each open step starts, already scoped to what the workspace holds:
 * the property form; for the lease, the dossier in preparation if there is
 * one, else the rental flow of the only lot that can be let, else the only
 * property, else the properties; the bank; the tenant-space panel of the
 * most recent tenancy in force.
 */
export function setupHrefs(r: Records): SetupHrefs {
  const draft = r.LEASES.filter((l) => l.status === "draft").sort((a, b) => b.seq - a.seq)[0];
  const letUnits = new Set(r.LEASES.filter((l) => live(l.status)).map((l) => l.unitId));
  const known = new Set(r.PROPERTIES.map((p) => p.id));
  const vacant = r.UNITS.filter((u) => known.has(u.propertyId) && isLettable(u) && !letUnits.has(u.id));
  const lease = draft
    ? `/app/biens/locataire?bail=${encodeURIComponent(draft.id)}`
    : vacant.length === 1
      ? `/app/biens/locataire?lot=${encodeURIComponent(vacant[0].id)}`
      : r.PROPERTIES.length === 1
        ? `/app/biens/${encodeURIComponent(r.PROPERTIES[0].id)}`
        : "/app/biens";
  const running = r.LEASES.filter((l) => live(l.status)).sort((a, b) => b.seq - a.seq)[0];
  return {
    property: "/app/biens/nouveau",
    lease,
    bank: "/app/banque",
    invite: running ? `/app/baux/${encodeURIComponent(running.id)}#${INVITE_ANCHOR}` : "/app/baux",
  };
}

/** The anchor of the tenant-space panel on a lease's page. */
export const INVITE_ANCHOR = "espace-locataire";

/** What the shell carries for the setup card and the tour. */
export interface ShellSetup {
  facts: SetupFacts;
  hrefs: SetupHrefs;
  /** `morada_mobile.tour === 1` on the account: the first-run tour was seen, on the web or in the app. */
  tourSeen: boolean;
  /** The tour may run here: the account's own data, signed in (never a sample cabinet nor the empty preview). */
  guide: boolean;
}

export function tourSeenOn(metadata: Record<string, unknown> | undefined | null): boolean {
  const mobile = metadata?.morada_mobile;
  return typeof mobile === "object" && mobile !== null && (mobile as Record<string, unknown>).tour === 1;
}

/** `morada_mobile` with the tour marked seen, every other key kept as it was. */
export function withTourSeen(metadata: Record<string, unknown> | undefined | null): Record<string, unknown> {
  const mobile = metadata?.morada_mobile;
  const previous = typeof mobile === "object" && mobile !== null && !Array.isArray(mobile) ? (mobile as Record<string, unknown>) : {};
  return { ...previous, tour: 1 };
}

export function shellSetup(r: Records, opts: { tourSeen: boolean; guide: boolean }): ShellSetup {
  return { facts: setupFacts(r), hrefs: setupHrefs(r), tourSeen: opts.tourSeen, guide: opts.guide };
}

/* ------------------------------ the tour's rules ---------------------------- */

/**
 * This browser's memory of the tour (localStorage): "1" once it was seen or
 * skipped here. Read before the tour opens. `TOUR_QUIET` ("off") also stops
 * the card being pointed out again on later returns: a browser test sets it
 * in an init script and the overlay never shows.
 */
export const TOUR_SEEN_KEY = "morada.tour.seen";
export const TOUR_QUIET = "off";
/** The setup count the card was last pointed out at (localStorage), so a return with one more step done points it out again. */
export const TOUR_COUNT_KEY = "morada.tour.count";

export type TourMode = "full" | "card" | "off";

/**
 * Which tour plays on Accueil. The full one (one stop, then the card) once
 * per account while a step is open; afterwards the card alone, once per
 * newly completed step, while the setup is incomplete.
 */
export function tourMode(s: { guide: boolean; complete: boolean; seenOnAccount: boolean; seenHere: boolean; quiet?: boolean; lastCount: number | null; count: number }): TourMode {
  if (!s.guide || s.complete || s.quiet) return "off";
  if (!s.seenOnAccount && !s.seenHere) return "full";
  return s.lastCount !== null && s.count > s.lastCount ? "card" : "off";
}

/** The kind the property form opens with (`?type=`): the three the sign-up asks about, nothing else. */
export type FirstPropertyType = "apartment" | "house" | "building";
export function propertyTypeParam(raw: string | null | undefined): FirstPropertyType | null {
  return raw === "apartment" || raw === "house" || raw === "building" ? raw : null;
}

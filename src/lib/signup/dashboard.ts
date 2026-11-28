import { z } from "zod";
import type { Preferences } from "./model";

/**
 * The home screen's sections and the person's choice of them, ported from
 * the iPhone app's `src/lib/dashboard.ts` so the sign-up on the web saves
 * `morada_mobile.dashboard` in the shape the app reads (the app's Accueil
 * opens on it; the web keeps it for its own home screen later). Everyone
 * starts with the same four sections; what the person picks comes first and
 * switches on the optional ones (costs, requests).
 */
export const WIDGETS = ["arrears", "cashflow", "actions", "costs", "requests", "activity"] as const;
export type Widget = (typeof WIDGETS)[number];
export const DEFAULT_ON: readonly Widget[] = ["arrears", "cashflow", "actions", "activity"];

/** The period the cash flow opens on. */
export const HORIZONS = ["month", "year"] as const;
export type Horizon = (typeof HORIZONS)[number];
/** What the person watches closely: these actions come first. */
export const WATCHES = ["arrears", "vacancy", "edl_exit", "ticket", "invite"] as const;
export type Watch = (typeof WATCHES)[number];

/** The quiz's "when do you notice a late rent" answer. */
export const LATENESS = ["same_day", "days", "month_end", "never"] as const;
export type Lateness = (typeof LATENESS)[number];

export interface DashboardPrefs { order: Widget[]; hidden: Widget[]; interests: Widget[]; horizon: Horizon; watch: Watch[] }

export const DEFAULT_DASHBOARD: DashboardPrefs = { order: [...WIDGETS], hidden: WIDGETS.filter((w) => !DEFAULT_ON.includes(w)), interests: [], horizon: "month", watch: [] };

/** The layout the interests imply: chosen sections first (in the usual order), then the defaults, the optional ones off unless chosen. */
export function fromInterests(interests: readonly Widget[], extra: { horizon?: Horizon; watch?: readonly Watch[] } = {}): DashboardPrefs {
  const chosen = WIDGETS.filter((w) => interests.includes(w));
  const rest = { horizon: extra.horizon ?? "month", watch: WATCHES.filter((w) => extra.watch?.includes(w)) };
  if (chosen.length === 0) return { ...DEFAULT_DASHBOARD, ...rest };
  const order = [...chosen, ...WIDGETS.filter((w) => !chosen.includes(w))];
  return { order, hidden: WIDGETS.filter((w) => !chosen.includes(w) && !DEFAULT_ON.includes(w)), interests: chosen, ...rest };
}

/** The sections to draw, in order. */
export const visibleWidgets = (prefs: DashboardPrefs): Widget[] => prefs.order.filter((w) => !prefs.hidden.includes(w));

/**
 * The home screen from the sign-up quiz: the pain the person named decides
 * which sections come first and what the actions watch. Someone who hears
 * of a late rent after days or at month end gets arrears watched whatever
 * they named; finances put the year in view.
 */
export function dashboardFromQuiz(challenge: Preferences["challenge"], late: Lateness | null): DashboardPrefs {
  const byChallenge: Record<NonNullable<Preferences["challenge"]>, { interests: Widget[]; watch: Watch[]; horizon?: Horizon }> = {
    rent: { interests: ["arrears", "actions", "cashflow"], watch: ["arrears"] },
    documents: { interests: ["actions", "activity"], watch: ["edl_exit", "invite"] },
    compliance: { interests: ["actions", "arrears", "activity"], watch: ["edl_exit", "arrears"] },
    finances: { interests: ["cashflow", "costs", "arrears"], watch: ["arrears"], horizon: "year" },
    maintenance: { interests: ["requests", "actions", "activity"], watch: ["ticket"] },
  };
  const base = challenge ? byChallenge[challenge] : { interests: [] as Widget[], watch: [] as Watch[] };
  const watch = late && late !== "same_day" && !base.watch.includes("arrears") ? [...base.watch, "arrears" as Watch] : base.watch;
  if (base.interests.length === 0) return { ...DEFAULT_DASHBOARD, horizon: base.horizon ?? "month", watch };
  // The pain named leads, in the quiz's order (unlike `fromInterests`, which keeps the catalogue's).
  const order = [...base.interests, ...WIDGETS.filter((w) => !base.interests.includes(w))];
  return { order, hidden: WIDGETS.filter((w) => !base.interests.includes(w) && !DEFAULT_ON.includes(w)), interests: base.interests, horizon: base.horizon ?? "month", watch };
}

const unique = <T,>(list: T[]) => new Set(list).size === list.length;
const widgets = z.array(z.enum(WIDGETS)).max(WIDGETS.length).refine(unique);

/** What the profile route accepts as `morada_mobile.dashboard`: the app's shape, the app's keys, each at most once. */
export const dashboardSchema = z.object({
  order: widgets,
  hidden: widgets,
  interests: widgets,
  horizon: z.enum(HORIZONS),
  watch: z.array(z.enum(WATCHES)).max(WATCHES.length).refine(unique),
}).strict();

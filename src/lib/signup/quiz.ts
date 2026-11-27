import { z } from "zod";
import { RENT_BANDS } from "@/domain/billing/pricing";
import { UNITS_ANSWERS, type UnitsAnswer } from "./offer";
import { LATENESS, type Lateness } from "./dashboard";

/**
 * The eleven one-tap questions of the sign-up, in the iPhone app's order
 * (its `app/(onboarding)/quiz.tsx`): who the person is, what holds them
 * back, the goal, attribution last. The answer keys are the app's, so an
 * account started on one surface reads the same on the other. The lots and
 * the rent band give the offer its price without saying so; the pain named
 * orders the home screen; the lateness tunes what is watched.
 */
export const QUIZ_STEPS = ["kind", "manage", "units", "rent", "where", "today", "challenge", "time", "late", "goal", "source"] as const;
export type QuizStep = (typeof QUIZ_STEPS)[number];

export const KINDS = ["flats", "houses", "building", "mixed"] as const;
export const MANAGE = ["self", "family", "clients"] as const;
export const WHERE = ["lu", "be", "fr", "de", "multi"] as const;
export const TODAY = ["spreadsheet", "software", "paper", "starting"] as const;
export const CHALLENGES = ["rent", "documents", "compliance", "finances", "maintenance"] as const;
export const INVOLVEMENT = ["1", "5", "20", "40"] as const;
export const GOALS = ["rent", "everything", "time", "tax", "grow"] as const;
export const SOURCES = ["instagram", "tiktok", "word", "search", "press", "other"] as const;

export type Kind = (typeof KINDS)[number];
export type Challenge = (typeof CHALLENGES)[number];

/** One emoji per answer, the app's own. */
export const EMOJI = {
  kind: { flats: "🏢", houses: "🏡", building: "🏬", mixed: "🧩" },
  manage: { self: "🙋", family: "👨‍👩‍👧", clients: "💼" },
  units: { "1": "🏠", "2-5": "🏘️", "6-10": "🏢", "11-20": "🏙️", "21-50": "🌆", "0": "🌱" },
  rent: ["🪙", "💶", "💰", "💎", "👑"],
  where: { lu: "🇱🇺", be: "🇧🇪", fr: "🇫🇷", de: "🇩🇪", multi: "🌍" },
  today: { spreadsheet: "📊", software: "💻", paper: "📬", starting: "✨" },
  challenge: { rent: "⏰", documents: "📁", compliance: "⚖️", finances: "📈", maintenance: "🔧" },
  time: ["🕐", "🕔", "📅", "🔥"],
  late: { same_day: "⚡", days: "🕒", month_end: "📆", never: "🤷" },
  goal: { rent: "💶", everything: "🗂️", time: "⏳", tax: "🧾", grow: "🏡" },
  source: { instagram: "📸", tiktok: "🎵", word: "🗣️", search: "🔍", press: "📰", other: "✨" },
} as const;

/** What the funnel holds between questions. `rent` is the band (0 to 4), `time` the web's `involvement`. */
export interface QuizAnswers {
  kind: Kind | null;
  manage: (typeof MANAGE)[number] | null;
  units: UnitsAnswer | null;
  rent: number | null;
  where: (typeof WHERE)[number] | null;
  today: (typeof TODAY)[number] | null;
  challenge: Challenge | null;
  time: (typeof INVOLVEMENT)[number] | null;
  late: Lateness | null;
  goal: (typeof GOALS)[number] | null;
  source: (typeof SOURCES)[number] | null;
}

export const EMPTY_ANSWERS: QuizAnswers = { kind: null, manage: null, units: null, rent: null, where: null, today: null, challenge: null, time: null, late: null, goal: null, source: null };

/** The stored value of an answer as the screen compares it (the band as a string). */
export function answerOf(answers: QuizAnswers, step: QuizStep): string | null {
  const value = answers[step === "manage" ? "manage" : step];
  return value === null ? null : String(value);
}

/** The answers with one more taken; anything outside the question's keys is ignored. */
export function answer(answers: QuizAnswers, step: QuizStep, value: string): QuizAnswers {
  const keys = optionsOf(step);
  if (!keys.includes(value)) return answers;
  if (step === "rent") return { ...answers, rent: Number(value) };
  return { ...answers, [step]: value } as QuizAnswers;
}

/** The keys a question offers, in order. */
export function optionsOf(step: QuizStep): readonly string[] {
  switch (step) {
    case "kind": return KINDS;
    case "manage": return MANAGE;
    case "units": return UNITS_ANSWERS;
    case "rent": return RENT_BANDS.map((_, i) => String(i));
    case "where": return WHERE;
    case "today": return TODAY;
    case "challenge": return CHALLENGES;
    case "time": return INVOLVEMENT;
    case "late": return LATENESS;
    case "goal": return GOALS;
    case "source": return SOURCES;
  }
}

/** The first question still unanswered (1-based), 12 when all are. */
export function firstOpen(answers: QuizAnswers): number {
  const i = QUIZ_STEPS.findIndex((step) => answerOf(answers, step) === null);
  return i < 0 ? QUIZ_STEPS.length + 1 : i + 1;
}

/** `?q=` as a question number, within 1 and 11. */
export function questionFromParam(raw: string | null | undefined): number {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(QUIZ_STEPS.length, n) : 1;
}

/**
 * `morada_mobile.quiz`, the app's shape (its `recordQuiz`): every key the
 * app writes, `offer` set once the offer screen has its outcome. Strict:
 * the profile route refuses any other key and any value that is not one of
 * the app's.
 */
export const quizSchema = z.object({
  kind: z.enum(KINDS).nullable(),
  manageFor: z.enum(MANAGE).nullable(),
  units: z.enum(UNITS_ANSWERS).nullable(),
  where: z.enum(WHERE).nullable(),
  today: z.enum(TODAY).nullable(),
  late: z.enum(LATENESS).nullable(),
  goal: z.enum(GOALS).nullable(),
  source: z.enum(SOURCES).nullable(),
}).strict();
export type StoredQuiz = z.infer<typeof quizSchema>;

/** The answers as `morada_mobile.quiz` keeps them. */
export const storedQuiz = (a: QuizAnswers): StoredQuiz => ({ kind: a.kind, manageFor: a.manage, units: a.units, where: a.where, today: a.today, late: a.late, goal: a.goal, source: a.source });

/** Back from what an account holds (another surface may have written it): unknown values read as unanswered. */
export function answersFromStored(raw: unknown, band: number | null = null): QuizAnswers {
  const q = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pick = <T extends string>(keys: readonly T[], value: unknown): T | null => (typeof value === "string" && (keys as readonly string[]).includes(value) ? (value as T) : null);
  return {
    ...EMPTY_ANSWERS,
    kind: pick(KINDS, q.kind), manage: pick(MANAGE, q.manageFor), units: pick(UNITS_ANSWERS, q.units), where: pick(WHERE, q.where),
    today: pick(TODAY, q.today), late: pick(LATENESS, q.late), goal: pick(GOALS, q.goal), source: pick(SOURCES, q.source),
    rent: band !== null && Number.isInteger(band) && band >= 0 && band < RENT_BANDS.length ? band : null,
  };
}

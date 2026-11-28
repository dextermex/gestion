import { z } from "zod";
import type { User } from "@supabase/supabase-js";
import { offerSchema } from "./offer";
import { quizSchema } from "./quiz";
import { dashboardSchema } from "./dashboard";

export const roleSchema = z.enum(["landlord", "tenant"]);
export const preferenceSchema = z.object({
  properties: z.enum(["0", "1", "2-5", "6-10", "11+"]).nullable(),
  challenge: z.enum(["maintenance", "compliance", "rent", "documents", "finances"]).nullable(),
  involvement: z.enum(["1", "5", "20", "40"]).nullable(),
});
export type Preferences = z.infer<typeof preferenceSchema>;
export type SignupRole = z.infer<typeof roleSchema>;
/** What the offer screen came to, in the app's words (`morada_mobile.quiz.offer`). */
export const OFFER_OUTCOMES = ["paywall", "winback", "declined"] as const;
export type OfferOutcome = (typeof OFFER_OUTCOMES)[number];
export const EMPTY_PREFERENCES: Preferences = { properties: null, challenge: null, involvement: null };

export const profileInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("details"), firstName: z.string().trim().min(1).max(60), lastName: z.string().trim().min(1).max(60), role: roleSchema, locale: z.enum(["fr", "en", "de", "lu"]) }),
  z.object({ action: z.literal("email"), email: z.string().trim().email().max(160) }),
  // Kept for an invitation's sign-up, which waits for the address to be confirmed (its acceptance reads it).
  z.object({ action: z.literal("email_confirmed") }),
  // Supabase stores only a bcrypt hash; 72 bytes is bcrypt's limit.
  z.object({ action: z.literal("password"), password: z.string().min(8).max(72) }),
  // The questions' answers, in the iPhone app's keys: `morada_signup.preferences` (the web's shape), `morada_mobile.quiz` and `morada_mobile.dashboard`.
  z.object({ action: z.literal("complete"), preferences: preferenceSchema, quiz: quizSchema.optional(), dashboard: dashboardSchema.optional() }),
  // What the offer screen came to (`morada_mobile.quiz.offer`) and the price it quoted (`morada_mobile.offer`): bookkeeping, never access.
  z.object({ action: z.literal("offer"), outcome: z.enum(OFFER_OUTCOMES), offer: offerSchema }),
]);

export type SignupStep =
  | "login" | "password" | "phone" | "verify" | "role" | "name" | "email" | "email-code" | "create-password"
  /** The eleven questions (`?q=` names one); the name is the one `resumeStep` has always returned for them. */
  | "properties"
  | "interests" | "potential" | "reviews" | "setup" | "ready" | "try" | "reminder" | "offer" | "winback"
  | "welcome" | "existing" | "reset";

/**
 * Account creation, in the iPhone app's order: phone code, role, name,
 * email (recorded, not verified here: the confirmation mail goes out on its
 * own), password, then (landlords) the eleven questions, the plan, the
 * trial and the offer. `morada_signup.stage` records the last step the
 * server accepted: role, email, password, tailor, complete (`email_code`
 * on accounts from before October 2026, and on an invitation's sign-up,
 * which still confirms its address).
 */
export type SignupStage = "role" | "email" | "email_code" | "password" | "tailor" | "complete";

/** `ref` is the public site's placement tag the account arrived with (`/inscription?ref=`), when it carried one. */
type SignupMeta = { version?: number; stage?: SignupStage; role?: SignupRole; password_set_at?: string; completed_at?: string; ref?: string };

export const signupMeta = (user: Pick<User, "user_metadata">): SignupMeta | null => user.user_metadata?.morada_signup ?? null;
export const emailConfirmed = (user: Pick<User, "email" | "email_confirmed_at" | "new_email">) => !!user.email && !!user.email_confirmed_at && !user.new_email;

/** An account opened with Apple or Google (Supabase lists the identity's provider). */
export const providerAccount = (user: Pick<User, "app_metadata">): boolean => {
  const providers = (user.app_metadata?.providers as string[] | undefined) ?? [];
  return providers.includes("apple") || providers.includes("google") || user.app_metadata?.provider === "apple" || user.app_metadata?.provider === "google";
};

/** The address the funnel took, confirmed or still pending (the confirmation mail goes out, nothing waits on it). */
export const emailGiven = (user: Pick<User, "email" | "email_confirmed_at" | "new_email">) => emailConfirmed(user) || !!user.new_email;

/**
 * Where an account continues: the iPhone app's `resumeStep`, word for word
 * (docs/WEB-ONBOARDING.md, A.6), so an account started on one surface goes
 * on at the same step on the other. Its two departures from the web's
 * former rules (the owner's decision of October 2026): an Apple or Google
 * account skips the phone and the password, and the e-mail is asked but
 * never verified in the funnel (a pending address does not send a finished
 * account back to a code).
 */
export function resumeStep(user: Pick<User, "user_metadata" | "app_metadata" | "phone_confirmed_at" | "email" | "email_confirmed_at" | "new_email">): SignupStep {
  const meta = signupMeta(user);
  // Accounts from the email registration (or morada.lu) were never in this funnel.
  if (!meta) return "existing";
  const provider = providerAccount(user);
  if (!user.phone_confirmed_at && !provider) return "phone";
  if (!meta.role || !meta.stage || meta.stage === "role") return "role";
  if (meta.stage === "email" || !emailGiven(user)) return "email";
  if (!meta.password_set_at && !provider) return "create-password";
  if (meta.stage === "tailor" && meta.role === "landlord") return "properties";
  if (meta.stage === "email_code" || meta.stage === "password") return provider ? "properties" : "create-password";
  return "existing";
}

/**
 * The step this browser opens, from `resumeStep`: the same, except that an
 * account created to accept an invitation still confirms its address with
 * the code before going on, because accepting reads the confirmed address
 * (src/components/gestion/InvitationAccept.tsx).
 */
export function funnelStep(user: Parameters<typeof resumeStep>[0], invited: boolean): SignupStep {
  const step = resumeStep(user);
  if (!invited || ["phone", "role", "email"].includes(step) || emailConfirmed(user) || !user.new_email) return step;
  return "email-code";
}

/** Navigation only. These preferences never confer permissions or tenant access. */
export function safeSignupNext(raw: string | null | undefined, role: SignupRole = "landlord"): string {
  const fallback = role === "tenant" ? "/locataire" : "/app";
  if (!raw || /[\\\u0000-\u0020\u007f]/.test(raw) || raw.startsWith("//")) return fallback;
  // Preserve invitation destinations, never arbitrary origins or auth loops.
  if (!/^\/(app|locataire|invitation)(\/|\?|$)/.test(raw)) return fallback;
  if (role === "tenant" && /^\/app(\/|\?|$)/.test(raw)) return fallback;
  try {
    const url = new URL(raw, "https://app.morada.lu");
    if (url.origin !== "https://app.morada.lu" || /%(2f|5c|2e|0[0-9a-f]|1[0-9a-f]|7f)/i.test(url.pathname)) return fallback;
    if (!/^\/(app|locataire|invitation)(\/|$)/.test(url.pathname)) return fallback;
    if (role === "tenant" && /^\/app(\/|$)/.test(url.pathname)) return fallback;
    return `${url.pathname}${url.search}`;
  } catch { return fallback; }
}

/**
 * Whether this page was opened by the password-recovery link itself: its
 * tokens with their type in the fragment (the default flow), or the code or
 * token hash it is exchanged by. A session that merely exists is not one.
 */
export function arrivedFromRecoveryLink(url: URL): boolean {
  const fragment = new URLSearchParams(url.hash.slice(1));
  return fragment.get("type") === "recovery" || url.searchParams.get("type") === "recovery" || url.searchParams.has("code") || url.searchParams.has("token_hash");
}

import { z } from "zod";
import type { User } from "@supabase/supabase-js";

export const roleSchema = z.enum(["landlord", "tenant"]);
export const preferenceSchema = z.object({
  properties: z.enum(["0", "1", "2-5", "6-10", "11+"]).nullable(),
  challenge: z.enum(["maintenance", "compliance", "rent", "documents", "finances"]).nullable(),
  involvement: z.enum(["1", "5", "20", "40"]).nullable(),
});
export type Preferences = z.infer<typeof preferenceSchema>;
export type SignupRole = z.infer<typeof roleSchema>;
export const EMPTY_PREFERENCES: Preferences = { properties: null, challenge: null, involvement: null };

export const profileInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("details"), firstName: z.string().trim().min(1).max(60), lastName: z.string().trim().min(1).max(60), role: roleSchema, locale: z.enum(["fr", "en", "de", "lu"]) }),
  z.object({ action: z.literal("email"), email: z.string().trim().email().max(160) }),
  z.object({ action: z.literal("email_confirmed") }),
  // Supabase stores only a bcrypt hash; 72 bytes is bcrypt's limit.
  z.object({ action: z.literal("password"), password: z.string().min(8).max(72) }),
  z.object({ action: z.literal("complete"), preferences: preferenceSchema }),
  // The plan a landlord picks for the free trial: noted for later, nothing is charged or required.
  z.object({ action: z.literal("plan"), plan: z.enum(["landlord", "professional"]), rhythm: z.enum(["quarter", "year"]) }),
]);

export type SignupStep = "login" | "password" | "phone" | "verify" | "role" | "name" | "email" | "email-code" | "create-password" | "properties" | "challenge" | "involvement" | "plan" | "welcome" | "existing" | "reset";

/**
 * Account creation, in order: phone code, role, name, email, email code,
 * password, then (landlords) three tailoring questions and the plan for the
 * free trial (noted, never charged here). `morada_signup.stage`
 * records the last step the server accepted: role, email, email_code,
 * password, tailor, complete. A password is set only after the email is
 * confirmed, so every finished account can sign in with email and password.
 */
export type SignupStage = "role" | "email" | "email_code" | "password" | "tailor" | "complete";

type SignupMeta = { version?: number; stage?: SignupStage; role?: SignupRole; password_set_at?: string };

export const signupMeta = (user: Pick<User, "user_metadata">): SignupMeta | null => user.user_metadata?.morada_signup ?? null;
export const emailConfirmed = (user: Pick<User, "email" | "email_confirmed_at" | "new_email">) => !!user.email && !!user.email_confirmed_at && !user.new_email;

/** Where an account continues, from what Auth verified (phone, email) and the recorded stage. */
export function resumeStep(user: Pick<User, "user_metadata" | "phone_confirmed_at" | "email" | "email_confirmed_at" | "new_email">): SignupStep {
  const meta = signupMeta(user);
  // Accounts from the email registration (or morada.lu) were never in this funnel.
  if (!meta) return "existing";
  if (!user.phone_confirmed_at) return "phone";
  if (!meta.role || !meta.stage || meta.stage === "role") return "role";
  if (meta.stage === "email") return "email";
  // Past the email step, including accounts finished before email codes and
  // passwords existed: the email must be confirmed, then a password set.
  if (!emailConfirmed(user)) return user.new_email ? "email-code" : "email";
  if (!meta.password_set_at) return "create-password";
  if (meta.stage === "tailor" && meta.role === "landlord") return "properties";
  return "existing";
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

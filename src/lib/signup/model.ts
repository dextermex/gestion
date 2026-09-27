import { z } from "zod";

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
  z.object({ action: z.literal("complete"), preferences: preferenceSchema }),
]);

export type SignupStep = "login" | "password" | "phone" | "verify" | "role" | "name" | "email" | "properties" | "challenge" | "involvement" | "welcome" | "existing" | "reset";

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

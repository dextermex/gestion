import type { User } from "@supabase/supabase-js";
import type { Locale } from "@/lib/i18n/config";
import { safeSignupNext } from "./model";

export type SocialProvider = "google" | "apple";

export function socialProviders(ready: boolean, preview = false): SocialProvider[] {
  if (!ready) return [];
  return [
    ...(preview || process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_ENABLED === "1" ? ["google" as const] : []),
    ...(preview || process.env.NEXT_PUBLIC_APPLE_SIGNIN_ENABLED === "1" ? ["apple" as const] : []),
  ];
}

export function oauthReturnUrl(origin: string, locale: Locale, intent: "link" | "login", next?: string) {
  const url = new URL("/inscription", origin);
  url.searchParams.set("oauth", intent);
  url.searchParams.set("lang", locale);
  if (intent === "login") url.searchParams.set("mode", "login");
  if (next) url.searchParams.set("next", safeSignupNext(next));
  return url.toString();
}

export const LINK_INTENT_KEY = "morada_signup_link";
export function confirmedEmail(user: User) {
  return !!user.email && !!user.email_confirmed_at && !user.new_email;
}

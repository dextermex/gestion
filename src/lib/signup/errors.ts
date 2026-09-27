import type { SignupCopy } from "@/lib/i18n/signup-fr";

/** Where in the funnel an Auth or API call failed: the same code can mean different things. */
export type SignupStage = "send" | "verify" | "login" | "reset" | "save";

/** Keys of the copy whose value is a sentence (not a list of options). */
export type SignupMessage = { [K in keyof SignupCopy]: SignupCopy[K] extends string ? K : never }[keyof SignupCopy];

type Failure = { code?: string; status?: number; name?: string } | null | undefined;

/**
 * Supabase Auth error codes (https://supabase.com/docs/guides/auth/debugging/error-codes)
 * and the profile API's own codes, mapped to a sentence a person can act on.
 * Never parse `message`: it is English, provider-specific and may echo input.
 */
export function signupErrorKey(stage: SignupStage, failure: Failure): SignupMessage {
  const code = failure?.code;
  if (!code) {
    // supabase-js reports a failed fetch as AuthRetryableFetchError with status 0;
    // the same class with a 5xx status is Supabase's outage, not the visitor's network.
    if (failure?.status === 0 || failure?.name === "TypeError" || (failure?.name === "AuthRetryableFetchError" && !failure.status)) return "networkError";
    return "unavailable";
  }
  if (code.includes("rate_limit")) return "rateLimited";
  switch (code) {
    case "captcha_failed": return "captchaError";
    case "sms_send_failed": return "smsFailed";
    case "phone_provider_disabled": return "phoneUnavailable";
    case "signup_disabled": return stage === "send" ? "phoneUnavailable" : "unavailable";
    // "Signups not allowed for otp": phone login for a number with no account.
    case "otp_disabled": return stage === "send" ? "noPhoneAccount" : "expiredCode";
    case "validation_failed": return stage === "send" ? "invalidPhone" : "unavailable";
    case "otp_expired": return "expiredCode";
    case "invalid_credentials": return "wrongPassword";
    case "email_not_confirmed": return "emailNotConfirmed";
    case "weak_password": return "weakPassword";
    case "same_password": return "samePassword";
    case "email_exists": return "emailExists";
    case "session_expired": case "phone_required": return "sessionExpired";
    case "save_failed": return "saveFailed";
    default: return "unavailable";
  }
}

/**
 * One console line per failed Auth call: stage, code, HTTP status. Never the
 * phone number, email, token or provider message (which can quote account
 * identifiers), so it is safe in production consoles and error reports.
 */
export function logSignupFailure(stage: SignupStage, failure: Failure): void {
  console.warn("[morada-signup]", stage, "failed", { code: failure?.code ?? null, status: failure?.status ?? null, name: failure?.name ?? null });
}
